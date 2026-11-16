import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {buildWriteSql,inventorySql,expectedInventory,outcomeSql} from './retire-test-buyins-controller.mjs';

const source=readFileSync(new URL('./retire-owner-confirmed-test-buyins-20261116.sql',import.meta.url),'utf8');
const action='owner_confirmed_legacy_test_buyin_retired_20261116';
const scopePattern=/INSERT INTO cleanup_scope\(id_hash,before_md5\) VALUES\n[\s\S]*?;\nDO \$cleanup\$/u;
test('reviewed cleanup is exact-scope, preserves evidence and has no delete or trigger bypass',()=>{
 assert.equal((source.match(/\('[a-f0-9]{64}','[a-f0-9]{32}'\)/gu)??[]).length,5);
 assert.ok(scopePattern.test(source));
 assert.doesNotMatch(source,/\bDELETE\s+FROM|\bTRUNCATE|DISABLE\s+TRIGGER|session_replication_role/iu);
 assert.match(source,/LOCK TABLE public\.tournaments IN SHARE MODE/u);
 assert.match(source,/TEST_CLEANUP_FINAL_DEPENDENCY_CHANGED/u);
 assert.doesNotMatch(source,/'before',before_row|'after',after_row/u);
});

test('actual restored PG17 schema: exact cancellation, rollback, evidence, retry and writer locks',
 {skip:process.env.TEST_BUYIN_CLEANUP_PG!=='1',timeout:90000},async()=>{
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGDATABASE,'vinpoker_ops_test_cleanup');
 assert.equal(process.env.PGUSER,'postgres');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const query=sql=>spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 const ok=sql=>{const r=query(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(ok("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999"),'t');
 assert.equal(ok('SELECT count(*) FROM public.tournament_registrations'),'0');
 assert.equal(ok("SELECT count(*) FROM pg_extension WHERE extname IN ('pg_net','pg_cron')"),'0');
 const actualGuards=JSON.parse(ok("SELECT jsonb_object_agg(n.nspname||'.'||p.proname,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN(SELECT tgfoid FROM pg_trigger WHERE tgrelid='public.tournament_registrations'::regclass AND NOT tgisinternal)"));
 assert.deepEqual(actualGuards,JSON.parse(readFileSync(new URL('./retire-test-buyins-trigger-hashes.json',import.meta.url),'utf8')),'restored applicable triggers must match actual live function definitions');
 assert.deepEqual(JSON.parse(ok(inventorySql)),expectedInventory,'full inspected trigger/FK/column inventory must match');
 const actor=randomUUID(),club=randomUUID();
 ok(`INSERT INTO auth.users(id) VALUES('${actor}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${actor}','Cleanup TEST owner');
 INSERT INTO public.clubs(id,owner_id,name,region,bot_enabled) VALUES('${club}','${actor}','Cleanup TEST','TEST',false);`);
 const ids=Array.from({length:5},()=>randomUUID()).sort();
 const tourIds=ids.map(()=>randomUUID());
 function currentScope(){
  const rows=JSON.parse(ok("SELECT jsonb_agg(jsonb_build_object('hash',encode(sha256(convert_to(id::text,'UTF8')),'hex'),'md5',md5(to_jsonb(r)::text)) ORDER BY id) FROM public.tournament_registrations r"));
  return source.replace(scopePattern,`INSERT INTO cleanup_scope(id_hash,before_md5) VALUES\n${rows.map(r=>`('${r.hash}','${r.md5}')`).join(',\n')};\nDO $cleanup$`);
 }
 function reset(){
  ok(`TRUNCATE public.audit_logs,public.tournament_registrations CASCADE;
   INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,confirmed_at,confirmed_by,transfer_proof_submitted,transfer_proof_image_url)
   VALUES ${ids.map((id,i)=>`('${id}','${tourIds[i]}','${actor}','${club}',1000,1100,'CLEANUP-TEST-${i}','${i===4?'pending':'confirmed'}',${i===4?'NULL':"'2026-07-01'::timestamptz"},${i===4?'NULL':`'${actor}'::uuid`},${i<2},${i<2?"'PRIVATE_TEST_PROOF_MARKER'":'NULL'})`).join(',')};`);
  return currentScope();
 }
 const context=`SELECT set_config('vinpoker.test_cleanup.project','orlesggcjamwuknxwcpk',true),
 set_config('vinpoker.test_cleanup.reviewed_sha','${'a'.repeat(40)}',true),
 set_config('vinpoker.test_cleanup.approved_owner','PhamGiaVinh',true);`;
 const authorized=sql=>sql.replace('BEGIN;',`BEGIN;\n${context}`);
 const snapshot=()=>ok('SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r');
 const auditCount=()=>Number(ok(`SELECT count(*) FROM public.audit_logs WHERE action='${action}'`));
 let sql=reset(),before=snapshot();
 assert.match(query(sql).stderr,/TEST_CLEANUP_REVIEWED_CONTEXT_REQUIRED/u);
 assert.equal(snapshot(),before);assert.equal(auditCount(),0);

 reset();ok(`UPDATE public.tournament_registrations SET price_snapshot='{}'::jsonb WHERE id='${ids[4]}'`);
 sql=currentScope();before=snapshot();
 assert.match(query(authorized(sql)).stderr,/TEST_CLEANUP_SOURCE_OR_DEPENDENCY_CHANGED/u);
 assert.equal(snapshot(),before);assert.equal(auditCount(),0);

 sql=reset();
 ok(`INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('${tourIds[4]}','${club}','Recreated metadata TEST','active','playing')`);
 before=snapshot();assert.match(query(authorized(sql)).stderr,/TEST_CLEANUP_SOURCE_OR_DEPENDENCY_CHANGED/u);
 assert.equal(snapshot(),before);assert.equal(auditCount(),0);
 // Leave that recreated tournament intact; later fixtures use another missing ID.
 tourIds[4]=randomUUID();

 sql=reset();
 const invokeAsync=input=>{
  const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','ignore','pipe']});let error='';p.stderr.on('data',v=>error+=v);
  const done=new Promise(resolve=>p.on('close',status=>resolve({status,error})));p.stdin.end(input);return done;
 };
 // Establish the first worker's real table/advisory locks before starting its rival.
 // Production SQL has no sleep; this test-only pause creates the upgrade race.
 const pauseAnchor='LOCK TABLE public.tournaments IN SHARE MODE;';
 assert.equal(sql.split(pauseAnchor).length,2);
 const first=invokeAsync("SET application_name='cleanup_test_first';"+authorized(sql).replace(pauseAnchor,pauseAnchor+' SELECT pg_sleep(0.7);'));
 const firstDeadline=Date.now()+2500;
 while(ok("SELECT count(*) FROM pg_stat_activity WHERE application_name='cleanup_test_first' AND wait_event='PgSleep'")==='0'){
  assert.ok(Date.now()<firstDeadline,'first maintenance lock barrier absent');await new Promise(r=>setTimeout(r,40));
 }
 const second=invokeAsync(authorized(sql));
 const concurrent=await Promise.all([first,second]);
 assert.equal(concurrent[0].status,0,concurrent[0].error);
 assert.equal(concurrent.filter(r=>r.status===0).length,1);assert.equal(auditCount(),5);
 assert.match(concurrent.find(r=>r.status!==0).error,/TEST_CLEANUP_SOURCE_OR_DEPENDENCY_CHANGED|lock timeout/u);

 sql=reset();
 ok(`INSERT INTO public.payment_settlements(tournament_registration_id,club_id,amount,outcome) VALUES('${ids[4]}','${club}',0,'dismissed')`);
 before=snapshot();
 assert.match(query(authorized(sql)).stderr,/TEST_CLEANUP_SOURCE_OR_DEPENDENCY_CHANGED/u);
 assert.equal(snapshot(),before);assert.equal(auditCount(),0);
 assert.equal(ok('SELECT count(*) FROM public.payment_settlements'),'1');

 sql=reset();
 const afterLoop='IF n<>5 THEN';assert.equal(sql.split(afterLoop).length,2);
 const maintenance=invokeAsync("SET application_name='cleanup_test_fk_maintenance';"+authorized(sql).replace(afterLoop,'PERFORM pg_sleep(2.5); '+afterLoop));
 const maintenanceDeadline=Date.now()+2500;
 while(ok("SELECT count(*) FROM pg_stat_activity WHERE application_name='cleanup_test_fk_maintenance' AND wait_event='PgSleep'")==='0'){
  assert.ok(Date.now()<maintenanceDeadline);await new Promise(r=>setTimeout(r,40));
 }
 const fkWriter=invokeAsync(`SET application_name='cleanup_test_fk_writer';INSERT INTO public.payment_settlements(tournament_registration_id,club_id,amount,outcome) VALUES('${ids[4]}','${club}',0,'dismissed');`);
 const fkDeadline=Date.now()+2000;
 while(ok("SELECT count(*) FROM pg_stat_activity WHERE application_name='cleanup_test_fk_writer' AND wait_event_type='Lock'")==='0'){
  assert.ok(Date.now()<fkDeadline,'real FK insert did not wait for row lock');await new Promise(r=>setTimeout(r,40));
 }
 assert.equal((await maintenance).status,0);assert.equal((await fkWriter).status,0);
 assert.equal(auditCount(),5);assert.equal(ok('SELECT count(*) FROM public.payment_settlements'),'1');
 assert.equal(ok(`SELECT status FROM public.tournament_registrations WHERE id='${ids[4]}'`),'cancelled');
 console.log('FK_WRITER_WAITED_THEN_REFERENCED_PRESERVED_CANCELLED_ROW_AFTER_COMMIT_NOT_PERMANENT_EXCLUSION');
 sql=reset();before=snapshot();
 for(const invalid of [authorized(sql).replace("'orlesggcjamwuknxwcpk'","'wrong-project'"),authorized(sql).replace("'PhamGiaVinh'","'another-actor'"),authorized(sql).replace(`'${'a'.repeat(40)}'`,"'invalid-sha'")]){
  assert.match(query(invalid).stderr,/TEST_CLEANUP_REVIEWED_CONTEXT_REQUIRED/u);
  assert.equal(snapshot(),before);assert.equal(auditCount(),0);
 }
 ok(buildWriteSql('a'.repeat(40)).replace(scopePattern,sql.match(scopePattern)[0]));
 const after=JSON.parse(snapshot());
 assert.ok(after.every(r=>r.status==='cancelled'));
 const fixturePairs=[...sql.matchAll(/\('([a-f0-9]{64})','([a-f0-9]{32})'\)/gu)].map(m=>`('${m[1]}','${m[2]}')`).join(',');
 const observedOutcome=outcomeSql('999','a'.repeat(40)).replace(/WITH targets\(hash,before_md5\) AS\(VALUES [\s\S]*?\),selected AS\(/u,`WITH targets(hash,before_md5) AS(VALUES ${fixturePairs}),selected AS(`);
 assert.deepEqual(JSON.parse(ok(observedOutcome)),{rows:5,preimages:0,cancelled:5,auditExact:5,inFlight:0});
 const strip=r=>{const v={...r};for(const k of ['status','cancelled_at','cancelled_by','cancellation_reason','updated_at'])delete v[k];return v;};
 assert.deepEqual(after.map(strip),JSON.parse(before).map(strip));assert.equal(auditCount(),5);
 const audit=ok(`SELECT jsonb_agg(payload) FROM public.audit_logs WHERE action='${action}'`);
 assert.ok(!audit.includes('PRIVATE_TEST_PROOF_MARKER'));
 const replay=query(authorized(sql));assert.notEqual(replay.status,0);assert.equal(auditCount(),5);

 sql=reset();ok(`UPDATE public.tournament_registrations SET buy_in=buy_in+1 WHERE id='${ids[4]}'`);before=snapshot();
 assert.match(query(authorized(sql)).stderr,/TEST_CLEANUP_SOURCE_OR_DEPENDENCY_CHANGED/u);
 assert.equal(snapshot(),before);assert.equal(auditCount(),0);

 sql=reset();before=snapshot();
 ok(`CREATE FUNCTION public.cleanup_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_cleanup_audit_failure';END $$;
 CREATE TRIGGER cleanup_test_fail_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.cleanup_test_fail_audit();`);
 assert.match(query(authorized(sql)).stderr,/injected_cleanup_audit_failure/u);
 assert.equal(snapshot(),before);assert.equal(auditCount(),0);
 ok('DROP TRIGGER cleanup_test_fail_audit ON public.audit_logs;DROP FUNCTION public.cleanup_test_fail_audit();');

 async function heldLock(lock){
  const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','ignore','pipe']});let error='';p.stderr.on('data',v=>error+=v);
  const done=new Promise(resolve=>p.on('close',status=>resolve({status,error})));
  p.stdin.end(`SET application_name='cleanup_test_lock';BEGIN;${lock};SELECT pg_sleep(3);ROLLBACK;`);
  const deadline=Date.now()+2500;
  while(ok("SELECT count(*) FROM pg_stat_activity WHERE application_name='cleanup_test_lock' AND wait_event='PgSleep'")==='0'){
   assert.ok(Date.now()<deadline,'lock barrier did not become ready');await new Promise(r=>setTimeout(r,40));
  }
  return done;
 }
 for(const lock of ['LOCK TABLE public.tournaments IN ROW EXCLUSIVE MODE',`SELECT id FROM public.tournament_registrations WHERE id='${ids[4]}' FOR UPDATE`]){
  sql=reset();before=snapshot();const donePromise=heldLock(lock);
  // heldLock resolves to the completion promise; wait for its explicit DB barrier here.
  const deadline=Date.now()+2500;
  while(ok("SELECT count(*) FROM pg_stat_activity WHERE application_name='cleanup_test_lock' AND wait_event='PgSleep'")==='0'){
   assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,40));
  }
  const result=query(authorized(sql));assert.notEqual(result.status,0);assert.match(result.stderr,/lock timeout/u);
  assert.equal(snapshot(),before);assert.equal(auditCount(),0);assert.equal((await donePromise).status,0);
 }
 console.log('TEST_BUYIN_CLEANUP_RESTORED_SCHEMA_ATOMIC_HISTORY_RETRY_LOCKS_PASS_NOT_PRODUCTION_APPLY');
});
