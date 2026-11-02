import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import ts from 'typescript';
import {mapWithConcurrency} from '../../supabase/functions/_shared/mapWithConcurrency.ts';
import {manualDealerIntentHeaders} from '../../supabase/functions/_shared/dealerMutationIntent.ts';

assert.equal(process.env.VINPOKER_CHECKOUT802_ROLLBACK,'1');
const concurrent=process.argv.includes('--concurrent');
const closeOverlap=process.argv.includes('--close-overlap');
const revokeOverlap=process.argv.includes('--revoke-overlap');
const swingOverlap=process.argv.includes('--swing-overlap827');
const fallback828=process.argv.includes('--fallback828');
const owned814=concurrent||closeOverlap||revokeOverlap||swingOverlap||fallback828;
if(owned814)assert.equal(process.env.VINPOKER_CHECKOUT814_COMMIT,'1','814 clone preparation/evidence writes require explicit LOCAL commit mode');
const database=owned814?'vinpoker_checkout814_race_local':'vinpoker_fnb719_gate_local';
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${database}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),owned814?'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948':'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
const tables=['dealers','dealer_attendance','dealer_breaks','dealer_assignments','audit_logs','dealer_payroll','payroll_periods','cashier_buyin_movements','tournaments','game_tables','table_sessions','tournament_tables','club_settings','centerpoint_tournament_ops_release'];
const fingerprint=(run=sql)=>run(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
const before=fingerprint(),dealer=randomUUID(),attendance=randomUUID(),breakId=randomUUID();
const preassigned=process.argv.includes('--preassigned');
assert.ok(!process.argv.includes('--unverified-transition'),'historical transition seam retired; use --lost-core-response');
const lostCoreResponse=process.argv.includes('--lost-core-response');
const edgeAtomic=process.argv.includes('--edge-atomic');
const handlerMode=process.argv.includes('--handler');
assert.ok(!handlerMode||edgeAtomic,'handler qualification requires --edge-atomic');
const releaseError=process.argv.includes('--release-error');
const atomicCandidate=process.argv.includes('--atomic-candidate')||edgeAtomic||owned814;
assert.ok(atomicCandidate,'current checkout requires --edge-atomic or --atomic-candidate --release-error');
assert.ok(edgeAtomic||releaseError||owned814,'SQL candidate qualification requires the real release fault');
assert.ok(!owned814||![preassigned,lostCoreResponse,releaseError,edgeAtomic,handlerMode].some(Boolean),'814 modes have their own exact committed fixtures');
assert.ok([concurrent,closeOverlap,revokeOverlap,swingOverlap,fallback828].filter(Boolean).length<=1,'qualify one concurrency seam at a time');
let candidate='';
if(atomicCandidate){
 candidate=readFileSync(new URL('../../supabase/migrations/20270128000289_dealer_checkout_atomic_v1.sql',import.meta.url),'utf8');
 assert.equal(candidate.split('\nBEGIN;').length,2);assert.match(candidate,/COMMIT;\s*$/);
 candidate=candidate.replace('\nBEGIN;','\n').replace(/COMMIT;\s*$/,'');
}
assert.ok([preassigned,lostCoreResponse,releaseError].filter(Boolean).length<=1,'qualify each transition seam independently');
const tour=randomUUID();
const actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',club='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
const role='checkout802_'+randomUUID().replaceAll('-','');
if(concurrent)assert.equal(sql("SELECT to_regclass('private.checkout814_fixture') IS NULL;"),'t','814 constructor consumed; use checkout814.postcheck.readonly.sql, never reset or recreate');
if(closeOverlap)assert.equal(sql("SELECT proof?'close815' FROM private.checkout814_fixture WHERE id;"),'f','815 proof already recorded; use read-only postcheck instead of rerunning consumed preparation');
if(revokeOverlap)assert.equal(sql("SELECT proof?'revoke816' FROM private.checkout814_fixture WHERE id;"),'f','816 permission revocation consumed; use read-only postcheck');
const resume827=process.env.VINPOKER_CHECKOUT827_RESUME==='1';
if(swingOverlap){
 assert.equal(sql("SELECT to_regclass('private.checkout827_fixture') IS NULL;"),resume827?'f':'t','827 constructor consumed; use explicit guarded resume only for its uncompleted attempt');
 if(resume827)assert.equal(sql("SELECT proof IS NULL FROM private.checkout827_fixture WHERE id;"),'t','completed827 cannot be replayed');
}
const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let output='',errors='',seq=0;
child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>{output+=s;});child.stderr.on('data',s=>{errors+=s;});
const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(errors)));});void closed.catch(()=>{});
async function query(q){
 const tag=`CHECKOUT802_${++seq}`;child.stdin.write(`\\echo ${tag}_START\n${q};\n\\echo ${tag}_END\n`);
 const end=Date.now()+10000;while(!output.includes(tag+'_END')){assert.equal(child.exitCode,null,errors);assert.ok(Date.now()<end,errors||'native query deadline');await delay(20);}
 return JSON.parse(output.split(tag+'_START')[1].split(tag+'_END')[0].trim());
}
const quote=v=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
if(concurrent){
 // Deliberately separate owned clone: uncommitted CREATE FUNCTION is invisible
 // to a second backend. Never install this candidate into the original reader
 // database or the719 rollback harness just to obtain a concurrency green.
 const sourceArgs=args.map(a=>a===`PGDATABASE=${database}`?'PGDATABASE=vinpoker_fnb719_gate_local':a);
 const sourceSql=q=>execFileSync('wsl',sourceArgs,{input:q,encoding:'utf8',timeout:15000}).trim();
 const sourceBefore=fingerprint(sourceSql);assert.equal(before,sourceBefore,'814 clone must start at the untouched719 facts');
 let second,secondDone;
 try{
  child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';
   ${candidate}
   CREATE TABLE private.checkout814_fixture(id boolean PRIMARY KEY DEFAULT true CHECK(id),manifest jsonb NOT NULL,proof jsonb);
   ALTER TABLE private.checkout814_fixture ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON private.checkout814_fixture FROM PUBLIC,anon,authenticated,service_role;
   CREATE TEMP TABLE checkout814_config_before AS SELECT to_jsonb(c) saved FROM public.centerpoint_tournament_ops_release c;
   INSERT INTO public.dealers(id,club_id,full_name) VALUES('${dealer}','${club}','LOCAL814 CONCURRENT CHECKOUT TEST');
   INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time)
    SELECT '${attendance}','${dealer}',shift_id,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in','available',now()-interval '9 hours'
    FROM public.dealer_attendance WHERE id='47323bd1-60a3-42a8-99c6-ede1c33f5f90';
   INSERT INTO public.tournaments(id,club_id,name,status,live_status,buy_in,starting_stack)
    VALUES('${tour}','${club}','LOCAL814 CONCURRENT CHECKOUT TEST','active','registering',0,20000);
   DO $$BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions s JOIN public.game_tables g ON g.id=s.game_table_id
    WHERE g.club_id='${club}' AND g.table_number=50 AND s.closed_at IS NULL);END $$;
   UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;
   DO $$DECLARE physical uuid;opened jsonb;BEGIN
    SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id='${club}' AND table_number=50;
    opened:=public.floor_open_tournament_table_v3('${tour}',physical,'manual',gen_random_uuid());ASSERT opened->>'ok'='true',opened::text;
   END $$;
   RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';
   DO $$DECLARE target record;assigned jsonb;BEGIN
    SELECT * INTO STRICT target FROM public.tournament_tables WHERE tournament_id='${tour}';
    assigned:=public.worker_assign_dealer_to_session_v1('${club}',target.game_table_id,target.table_session_id,'${attendance}',now()+interval '45 minutes','LOCAL814-${attendance}');
    ASSERT assigned->>'outcome'='ok',assigned::text;
    INSERT INTO private.checkout814_fixture(manifest) VALUES(jsonb_build_object('source_head','ef6a26948','club', '${club}', 'actor','${actor}',
     'dealer','${dealer}','attendance','${attendance}','tournament','${tour}','physical',target.game_table_id,'session',target.table_session_id,'assignment',assigned->>'assignment_id'));
   END $$;
   UPDATE public.centerpoint_tournament_ops_release c SET enabled=b.enabled,allowed_club_ids=b.allowed_club_ids
    FROM(SELECT (jsonb_populate_record(NULL::public.centerpoint_tournament_ops_release,saved)).* FROM checkout814_config_before)b WHERE c.id=b.id;
   DO $$BEGIN ASSERT (SELECT jsonb_agg(to_jsonb(c) ORDER BY to_jsonb(c)::text) FROM public.centerpoint_tournament_ops_release c)
    =(SELECT jsonb_agg(saved ORDER BY saved::text) FROM checkout814_config_before);END $$;
   COMMIT;
   BEGIN;SET LOCAL application_name='checkout814_holder';SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='20s';
   SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET LOCAL ROLE service_role;\n`);
  const first=await query(`SELECT public.operator_checkout_dealer_attendance_v1('${actor}','${attendance}')`);
  assert.equal(first.success,true);assert.equal(first.idempotent,false);assert.equal(first.total_hours,9);
  second=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
  second.stdout.on('data',s=>out+=String(s));second.stderr.on('data',s=>err+=String(s));
  secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));});void secondDone.catch(()=>{});
  second.stdin.end(`BEGIN;SET LOCAL application_name='checkout814_waiter';SET LOCAL statement_timeout='12s';
   SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET LOCAL ROLE service_role;
   SELECT public.operator_checkout_dealer_attendance_v1('${actor}','${attendance}');COMMIT;\n`);
  let waited=false;const until=Date.now()+7000;
  while(Date.now()<until){
   assert.equal(second.exitCode,null,'second checkout finished without an observed overlapping lock');
   waited=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='checkout814_waiter' AND a.application_name='checkout814_holder' AND b.wait_event_type='Lock');")==='t';
   if(waited)break;await delay(50);
  }
  assert.ok(waited,'no actual PostgreSQL blocking barrier observed');
  child.stdin.write('COMMIT;\n');
  const replay=JSON.parse(await secondDone);assert.equal(replay.idempotent,true);assert.deepEqual({...replay,idempotent:false},first);
  const proof=await query(`SELECT jsonb_build_object('attendance',(SELECT jsonb_build_object('status',status,'state',current_state,'worked',total_worked_minutes_today,'ot',overtime_minutes) FROM public.dealer_attendance WHERE id='${attendance}'),
   'live_assignments',(SELECT count(*) FROM public.dealer_assignments WHERE attendance_id='${attendance}' AND released_at IS NULL),
   'audit_count',(SELECT count(*) FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text='${attendance}'),
   'receipt_count',(SELECT count(*) FROM private.dealer_checkout_receipts_v1 WHERE attendance_id='${attendance}'))`);
  assert.deepEqual(proof,{attendance:{status:'checked_out',state:'checked_out',worked:540,ot:60},live_assignments:0,audit_count:1,receipt_count:1});
  const saved={barrier_observed:waited,first,replay,postcondition:proof,source_fingerprint:sourceBefore};
  await query(`WITH saved AS(UPDATE private.checkout814_fixture SET proof=${quote(JSON.stringify(saved))}::jsonb WHERE id AND proof IS NULL RETURNING id)SELECT to_jsonb(count(*)) FROM saved`);
  assert.equal(fingerprint(sourceSql),sourceBefore);
  console.log('CHECKOUT814_TWO_REAL_BACKENDS_BLOCK_THEN_COMMIT_ONE_CHECKOUT_ONE_AUDIT_ONE_RECEIPT_REPLAY_PASS');
 }finally{
  if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');
  await Promise.allSettled([closed,secondDone].filter(Boolean));
  assert.equal(fingerprint(sourceSql),sourceBefore,'719 source facts changed');
  console.log('CHECKOUT814_ORIGINAL719_SOURCE_UNCHANGED_NEW_CLONE_EVIDENCE_RETAINED');
 }
}else if(closeOverlap){
 const sourceArgs=args.map(a=>a===`PGDATABASE=${database}`?'PGDATABASE=vinpoker_fnb719_gate_local':a);
 const sourceSql=q=>execFileSync('wsl',sourceArgs,{input:q,encoding:'utf8',timeout:15000}).trim();
 const sourceBefore=fingerprint(sourceSql);
 const root=JSON.parse(sql('SELECT manifest FROM private.checkout814_fixture WHERE id;'));
 assert.equal(root.actor,actor);assert.equal(root.club,club);
 assert.equal(sql("SELECT proof->>'barrier_observed' FROM private.checkout814_fixture WHERE id;"),'true');
 const serviceAuth=`RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET LOCAL ROLE service_role;`;
 const floorAuth=`RESET ROLE;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 let fixture=root.close815;
 const workers=[];
 try{
  if(!fixture){
   child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';
    INSERT INTO public.dealers(id,club_id,full_name) VALUES('${dealer}','${club}','LOCAL815 CLOSE CHECKOUT OVERLAP TEST');
    INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time)
     SELECT '${attendance}','${dealer}',shift_id,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in','available',now()-interval '9 hours'
     FROM public.dealer_attendance WHERE id='47323bd1-60a3-42a8-99c6-ede1c33f5f90';
    ${serviceAuth}
    DO $$DECLARE assigned jsonb;BEGIN
     assigned:=public.worker_assign_dealer_to_session_v1('${club}','${root.physical}','${root.session}','${attendance}',now()+interval '45 minutes','LOCAL815-${attendance}');
     ASSERT assigned->>'outcome'='ok',assigned::text;
    END $$;
    RESET ROLE;
    UPDATE private.checkout814_fixture SET manifest=manifest||jsonb_build_object('close815',
     jsonb_build_object('dealer','${dealer}','attendance','${attendance}','close_request','${randomUUID()}',
     'table',(SELECT id FROM public.tournament_tables WHERE tournament_id='${root.tournament}'),
     'revision',(SELECT revision FROM public.table_sessions WHERE id='${root.session}')))
     WHERE id AND NOT manifest?'close815';COMMIT;\n`);
   fixture=await query("SELECT manifest->'close815' FROM private.checkout814_fixture WHERE id");
  }
  assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE id='${fixture.attendance}' AND status='checked_in' AND current_state='assigned' AND check_out_time IS NULL;`),'1');
  const prepared=fingerprint();
  const checkout=`SELECT public.operator_checkout_dealer_attendance_v1('${actor}','${fixture.attendance}')`;
  const close=`SELECT public.close_tournament_table_v4('${fixture.table}',${Number(fixture.revision)},'${fixture.close_request}')`;
  async function overlap(name,holderAuth,holderCommand,waiterAuth,waiterCommand){
   child.stdin.write(`BEGIN;SET LOCAL application_name='checkout815_holder';SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='20s';${holderAuth}\n`);
   const held=await query(holderCommand);
   assert.equal(holderCommand===close?held.ok:held.success,true,JSON.stringify(held));
   const second=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
   const done=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));});void done.catch(()=>{});workers.push({second,done});
   second.stdout.on('data',s=>out+=String(s));second.stderr.on('data',s=>err+=String(s));
   second.stdin.end(`BEGIN;SET LOCAL application_name='checkout815_waiter';SET LOCAL statement_timeout='12s';${waiterAuth}
    ${waiterCommand};RESET ROLE;
    DO $$BEGIN ASSERT ${waiterCommand===close?`(SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${root.session}')`:`(SELECT status='checked_out' AND total_worked_minutes_today=540 FROM public.dealer_attendance WHERE id='${fixture.attendance}')`};END $$;
    ROLLBACK;\n`);
   let waited=false;const until=Date.now()+7000;
   while(Date.now()<until){
    assert.equal(second.exitCode,null,'waiter completed before actual lock barrier');
    waited=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='checkout815_waiter' AND a.application_name='checkout815_holder' AND b.wait_event_type='Lock');")==='t';
    if(waited)break;await delay(50);
   }
   assert.ok(waited,'no PostgreSQL overlap '+name);child.stdin.write('ROLLBACK;\n');
   const result=JSON.parse(await done);assert.equal(waiterCommand===close?result.ok:result.success,true,JSON.stringify(result));
   assert.equal(fingerprint(),prepared,'overlap did not fully rollback '+name);
   return {name,barrier_observed:waited,holder:held,waiter:result,business_rolled_back:true};
  }
  const a=await overlap('close_then_checkout',floorAuth,close,serviceAuth,checkout);
  const b=await overlap('checkout_then_close',serviceAuth,checkout,floorAuth,close);
  const proof={orders:[a,b],prepared_fingerprint:prepared,source_fingerprint:sourceBefore};
  assert.equal(await query(`WITH saved AS(UPDATE private.checkout814_fixture SET proof=proof||jsonb_build_object('close815',${quote(JSON.stringify(proof))}::jsonb) WHERE id AND NOT proof?'close815' RETURNING id)SELECT to_jsonb(count(*)) FROM saved`),1);
  console.log('CHECKOUT815_FLOOR_CLOSE_CHECKOUT_TWO_TRUE_OVERLAP_ORDERS_NO_DEADLOCK_FULL_BUSINESS_ROLLBACK_PASS');
 }finally{
  if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');
  await Promise.allSettled([closed,...workers.map(w=>w.done)]);
  assert.equal(fingerprint(sourceSql),sourceBefore);
  console.log('CHECKOUT815_ORIGINAL719_SOURCE_UNCHANGED_NEW_CLONE_FIXTURE_AND_PROOF_RETAINED');
 }
}else if(revokeOverlap){
 const sourceArgs=args.map(a=>a===`PGDATABASE=${database}`?'PGDATABASE=vinpoker_fnb719_gate_local':a);
 const sourceSql=q=>execFileSync('wsl',sourceArgs,{input:q,encoding:'utf8',timeout:15000}).trim();
 const sourceBefore=fingerprint(sourceSql);
 const root=JSON.parse(sql('SELECT manifest FROM private.checkout814_fixture WHERE id;'));
 const fixture=root.close815;assert.ok(fixture,'qualify close815 first');
 assert.equal(sql("SELECT proof?'close815' FROM private.checkout814_fixture WHERE id;"),'t');
 assert.equal(sql("SELECT proof?'revoke816' FROM private.checkout814_fixture WHERE id;"),'f','816 proof already recorded; inspect it rather than rerun consumed permission revocation');
 const control='675fe35e-60a8-4452-bb90-e79486d54da6';
 assert.equal(sql(`SELECT owner_id='${actor}'::uuid FROM public.clubs WHERE id='${club}';`),'t');
 const grantCount=sql(`SELECT count(*) FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${control}';`);
 if(!root.revoke816)assert.equal(grantCount,'0','never replace an existing permission');
 else assert.equal(grantCount,'1','816 grant already consumed; inspect retained state before proceeding');
 const serviceAuth=`RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${control}"}';SET LOCAL ROLE service_role;`;
 const checkout=`SELECT public.operator_checkout_dealer_attendance_v1('${control}','${fixture.attendance}')`;
 const remove=`WITH removed AS(DELETE FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${control}' AND granted_by='${actor}' RETURNING club_id)SELECT to_jsonb(count(*)) FROM removed`;
 const workers=[];
 try{
  if(!root.revoke816){
   child.stdin.write(`BEGIN;
    INSERT INTO public.club_dealer_controls(club_id,user_id,granted_by) VALUES('${club}','${control}','${actor}');
    UPDATE private.checkout814_fixture SET manifest=manifest||jsonb_build_object('revoke816',jsonb_build_object('actor','${control}','scope','OWNED_CLONE_ONLY_NEW_TEST_GRANT')) WHERE id AND NOT manifest?'revoke816';COMMIT;\n`);
   assert.equal(await query(`SELECT to_jsonb(public.is_club_dealer_control('${control}','${club}'))`),true);
  }
  const prepared=fingerprint();
  async function overlap(name,revokeFirst){
   child.stdin.write(`BEGIN;SET LOCAL application_name='checkout816_holder';SET LOCAL statement_timeout='12s';SET LOCAL idle_in_transaction_session_timeout='20s';${revokeFirst?'':serviceAuth}\n`);
   const held=await query(revokeFirst?remove:checkout);
   if(revokeFirst)assert.equal(held,1);else assert.equal(held.success,true);
   const second=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
   const done=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));});void done.catch(()=>{});workers.push(done);
   second.stdout.on('data',s=>out+=String(s));second.stderr.on('data',s=>err+=String(s));
   second.stdin.end(`BEGIN;SET LOCAL application_name='checkout816_waiter';SET LOCAL statement_timeout='12s';${revokeFirst?serviceAuth:''}
    ${revokeFirst?checkout:remove};${revokeFirst?'ROLLBACK':'COMMIT'};\n`);
   let waited=false;const until=Date.now()+7000;
   while(Date.now()<until){
    assert.equal(second.exitCode,null,'permission waiter completed without overlap');
    waited=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='checkout816_waiter' AND a.application_name='checkout816_holder' AND b.wait_event_type='Lock');")==='t';
    if(waited)break;await delay(50);
   }
   assert.ok(waited,'missing permission lock barrier '+name);child.stdin.write('ROLLBACK;\n');
   const result=JSON.parse(await done);if(revokeFirst)assert.equal(result.success,true);else assert.equal(result,1);
   assert.equal(fingerprint(),prepared,'permission race mutated checkout/payroll facts');
   return {name,barrier_observed:waited,holder:held,waiter:result,checkout_rolled_back:true,revocation_committed:!revokeFirst};
  }
  const a=await overlap('revoke_pending_checkout_waits_then_rollback',true);
  const b=await overlap('checkout_pending_revoke_waits_then_commits',false);
  assert.equal(sql(`SELECT public.is_club_dealer_control('${control}','${club}');`),'f');
  child.stdin.write(`CREATE FUNCTION pg_temp.checkout816_try(q text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE value jsonb;BEGIN
   EXECUTE q INTO value;RETURN jsonb_build_object('data',value,'error',NULL);
   EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('data',NULL,'error',SQLERRM,'code',SQLSTATE);END $$;
   BEGIN;${serviceAuth}\n`);
  const denied=await query(`SELECT pg_temp.checkout816_try(${quote(checkout)})`);
  assert.deepEqual(denied,{data:null,error:'DEALER_CHECKOUT_FORBIDDEN',code:'42501'});child.stdin.write('ROLLBACK;\n');
  assert.equal(fingerprint(),prepared);
  const proof={orders:[a,b],after_revocation:denied,prepared_fingerprint:prepared,source_fingerprint:sourceBefore};
  assert.equal(await query(`WITH saved AS(UPDATE private.checkout814_fixture SET proof=proof||jsonb_build_object('revoke816',${quote(JSON.stringify(proof))}::jsonb) WHERE id AND NOT proof?'revoke816' RETURNING id)SELECT to_jsonb(count(*)) FROM saved`),1);
  console.log('CHECKOUT816_PERMISSION_REVOCATION_TWO_REAL_OVERLAP_ORDERS_POSTCOMMIT_ACTOR_DENIED_NO_CHECKOUT_DELTA_PASS');
 }finally{
  if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');
  await Promise.allSettled([closed,...workers]);assert.equal(fingerprint(sourceSql),sourceBefore);
  console.log('CHECKOUT816_ORIGINAL719_UNCHANGED_ONLY_NEW_CLONE_TEST_PERMISSION_REVOKED_EVIDENCE_RETAINED');
 }
}else if(fallback828){
 const f=JSON.parse(sql('SELECT manifest FROM private.checkout827_fixture WHERE id AND proof IS NOT NULL;'));
 const oldDigest=sql("SELECT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure));");
 const installed=process.argv.includes('--fallback-installed829');
 if(installed)assert.equal(oldDigest,sql("SELECT installed_digest FROM private.fallback829_install WHERE id AND source_sha256='e88c694345bfd208c892af9c6364694abb9b024977df4913f568a429f3170630';"));
 else assert.equal(oldDigest,'58430628220aa26d854fdab0694394bd');
 const freshDealer=sql(`SELECT dealer_id FROM public.dealer_attendance WHERE id='${f.second}';`);
 assert.equal(sql(`SELECT floor_private.dealer_pool_attendance_matches_v1('${freshDealer}','${club}',statement_timestamp());`),'t','fresh control must be truly eligible now');
 const version=Number(sql(`SELECT version FROM public.dealer_assignments WHERE id='${f.assignment}' AND status='assigned' AND released_at IS NULL;`));
 assert.ok(Number.isSafeInteger(version)&&version>=0);
 const useCandidate=process.argv.includes('--fallback-candidate828');
 assert.ok(!installed||!useCandidate,'installed verification must not apply candidate again');
 const patch=useCandidate?readFileSync(new URL('../../supabase/migrations/20270128000292_dealer_swing_fallback_pool_scope_v1.sql',import.meta.url),'utf8').replace('\nBEGIN;','\n').replace(/COMMIT;\s*$/,''):'';
 try{
  child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';${patch}
   -- Only this NEW827 test attendance's priority marker changes, inside rollback.
   -- Valid low-priority availability must still beat INELIGIBLE legacy rows.
   UPDATE public.dealer_attendance SET priority_break_flag=true WHERE id='${f.second}';
   SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
   SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET LOCAL ROLE service_role;\n`);
  const result=await query(`SELECT public.worker_perform_swing(p_table_id:='${f.physical}',p_table_session_id:='${f.session}',p_assignment_id:='${f.assignment}',p_expected_version:=${version},p_next_attendance_id:=NULL,p_send_to_break:=true)`);
  console.log('FALLBACK828_ACTUAL_NATIVE_RESULT',JSON.stringify({candidate:useCandidate,result}));
  assert.equal(result.outcome,'swung','eligible dealer must not be blocked by a stale legacy fallback');
  child.stdin.write('RESET ROLE;\n');
  const actual=await query(`SELECT jsonb_build_object('attendance',attendance_id,'session',table_session_id) FROM public.dealer_assignments WHERE id='${result.new_assignment_id}'`);
  assert.deepEqual(actual,{attendance:f.second,session:f.session});assert.equal(result.comp_break_minutes,15);
  console.log('FALLBACK828_ELIGIBLE_CURRENT_DEALER_SELECTED_REST15_UNCHANGED_PASS');
 }finally{
  if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');await closed;
  assert.equal(fingerprint(),before,'828 changed retained business facts');
  assert.equal(sql("SELECT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure));"),oldDigest);
  console.log('FALLBACK828_FULL_ROLLBACK_SOURCE_ATTENDANCE_ASSIGNMENT_AUDIT_PRESERVED');
 }
}else if(swingOverlap){
 const root=JSON.parse(sql('SELECT manifest FROM private.checkout814_fixture WHERE id;'));
 const ids={outgoing:randomUUID(),first:randomUUID(),second:randomUUID()};
 const requests={outgoing:randomUUID(),first:randomUUID(),second:randomUUID(),open:randomUUID()};
 const floorAuth=`RESET ROLE;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const serviceAuth=`RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET LOCAL ROLE service_role;`;
 const workers=[];let prepared;
 try{
  if(!resume827){
  child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';
   CREATE TABLE private.checkout827_fixture(id boolean PRIMARY KEY DEFAULT true CHECK(id),manifest jsonb NOT NULL,proof jsonb);
   ALTER TABLE private.checkout827_fixture ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.checkout827_fixture FROM PUBLIC,anon,authenticated,service_role;
   CREATE TEMP TABLE checkout827_gate AS SELECT to_jsonb(c) saved FROM public.centerpoint_tournament_ops_release c;
   INSERT INTO public.dealers(id,club_id,full_name) VALUES
    ('${ids.outgoing}','${club}','LOCAL827 OUTGOING TEST'),('${ids.first}','${club}','LOCAL827 INCOMING A TEST'),('${ids.second}','${club}','LOCAL827 INCOMING B TEST');
   ${floorAuth}
   DO $$DECLARE r jsonb;BEGIN
    ${Object.keys(ids).map(k=>`r:=public.operator_check_in_dealer_v1('${ids[k]}','${club}','dc91889f-0f73-4e2c-aaf1-d539a6072aed','${requests[k]}');ASSERT r->>'ok'='true' AND r->>'outcome'='checked_in',r::text;`).join('\n')}
   END $$;
   RESET ROLE;
   DO $$BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions s JOIN public.game_tables g ON g.id=s.game_table_id WHERE g.club_id='${club}' AND g.table_number=96 AND s.closed_at IS NULL);END $$;
   UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
   ${floorAuth}
   DO $$DECLARE physical uuid;r jsonb;BEGIN
    SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id='${club}' AND table_number=96;
    r:=public.floor_open_tournament_table_v3('${root.tournament}',physical,'manual','${requests.open}');ASSERT r->>'ok'='true',r::text;
   END $$;
   RESET ROLE;
   UPDATE public.centerpoint_tournament_ops_release c SET enabled=b.enabled,allowed_club_ids=b.allowed_club_ids
    FROM(SELECT (jsonb_populate_record(NULL::public.centerpoint_tournament_ops_release,saved)).* FROM checkout827_gate)b WHERE c.id=b.id;
   DO $$DECLARE t record;a uuid;BEGIN
    SELECT tt.* INTO STRICT t FROM public.tournament_tables tt JOIN public.game_tables g ON g.id=tt.game_table_id WHERE tt.tournament_id='${root.tournament}' AND g.table_number=96 AND tt.status='active';
    SELECT id INTO STRICT a FROM public.dealer_attendance WHERE dealer_id='${ids.outgoing}' AND status='checked_in';
    PERFORM set_config('checkout827.physical',t.game_table_id::text,true);PERFORM set_config('checkout827.session',t.table_session_id::text,true);PERFORM set_config('checkout827.outgoing',a::text,true);
   END $$;
   ${serviceAuth}
   DO $$DECLARE r jsonb;BEGIN
    r:=public.worker_assign_dealer_to_session_v1('${club}',current_setting('checkout827.physical')::uuid,current_setting('checkout827.session')::uuid,current_setting('checkout827.outgoing')::uuid,statement_timestamp()+interval '30 minutes','LOCAL827-${requests.open}');ASSERT r->>'outcome'='ok',r::text;
   END $$;
   RESET ROLE;
   INSERT INTO private.checkout827_fixture(manifest) SELECT jsonb_build_object('actor','${actor}','club','${club}','tour','${root.tournament}',
    'physical',tt.game_table_id,'session',tt.table_session_id,'table',tt.id,'assignment',(SELECT id FROM public.dealer_assignments WHERE table_session_id=tt.table_session_id AND status='assigned' AND released_at IS NULL),
    'outgoing',(SELECT id FROM public.dealer_attendance WHERE dealer_id='${ids.outgoing}' AND status='checked_in'),
    'first',(SELECT id FROM public.dealer_attendance WHERE dealer_id='${ids.first}' AND status='checked_in'),
    'second',(SELECT id FROM public.dealer_attendance WHERE dealer_id='${ids.second}' AND status='checked_in'),'checkin_requests',${quote(JSON.stringify(requests))}::jsonb)
    FROM public.tournament_tables tt JOIN public.game_tables g ON g.id=tt.game_table_id WHERE tt.tournament_id='${root.tournament}' AND g.table_number=96 AND tt.status='active';
   DO $$BEGIN ASSERT (SELECT to_jsonb(c)=b.saved FROM public.centerpoint_tournament_ops_release c CROSS JOIN checkout827_gate b);ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='${club}' AND auto_swing_enabled);END $$;
   COMMIT;\n`);
  }
  const f=await query('SELECT manifest FROM private.checkout827_fixture WHERE id');prepared=fingerprint();
  // Never assume assignment starts at version1; canonical writer currently uses0.
  const expectedVersion=Number(sql(`SELECT version FROM public.dealer_assignments WHERE id='${f.assignment}' AND attendance_id='${f.outgoing}' AND status='assigned' AND released_at IS NULL;`));
  assert.ok(Number.isSafeInteger(expectedVersion)&&expectedVersion>=0);
  assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE id IN('${f.first}','${f.second}') AND status='checked_in' AND current_state='available' AND check_out_time IS NULL;`),'2','resume cannot reset an already committed checkout');
  const checkout=incoming=>`SELECT public.operator_checkout_dealer_attendance_v1('${actor}','${incoming}')`;
  const swing=incoming=>`SELECT public.worker_perform_swing(p_table_id:='${f.physical}',p_table_session_id:='${f.session}',p_assignment_id:='${f.assignment}',p_expected_version:=${expectedVersion},p_next_attendance_id:='${incoming}',p_send_to_break:=true)`;
  const proof={orders:[],prepared_fingerprint:prepared,expected_version:expectedVersion};
  async function waiter(auth,command,postcondition){
   const w=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
   w.stdout.on('data',s=>out+=String(s));w.stderr.on('data',s=>err+=String(s));
   const done=new Promise((resolve,reject)=>{w.on('error',reject);w.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));});void done.catch(()=>{});workers.push({w,done});
   w.stdin.end(`BEGIN;SET LOCAL application_name='checkout827_waiter';SET LOCAL statement_timeout='15s';${auth}
    CREATE FUNCTION pg_temp.checkout827_try(q text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN EXECUTE q INTO r;RETURN jsonb_build_object('data',r,'error',NULL);EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('message',SQLERRM,'sqlstate',SQLSTATE));END $$;
    SELECT pg_temp.checkout827_try(${quote(command)});RESET ROLE;DO $$BEGIN ${postcondition} END $$;ROLLBACK;\n`);
   return {w,done};
  }
  async function barrier(worker){let seen=false;const deadline=Date.now()+7000;while(Date.now()<deadline){
   if(worker.w.exitCode!==null){const detail=await worker.done.catch(e=>e.message);throw Error('waiter completed without native lock: '+detail);}
   seen=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='checkout827_waiter' AND a.application_name='checkout827_holder' AND b.wait_event_type='Lock');")==='t';
   if(seen)break;await delay(40);
  }assert.ok(seen,'no actual swing/checkout overlap');}
  // Checkout wins. The stale acquisition cannot seat the now checked-out dealer.
  child.stdin.write(`BEGIN;SET LOCAL application_name='checkout827_holder';SET LOCAL statement_timeout='15s';${serviceAuth}\n`);
  const departed=await query(checkout(f.first));assert.equal(departed.success,true);
  const acquisition=await waiter(serviceAuth,swing(f.first),`ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id='${f.first}' AND released_at IS NULL AND status IN('assigned','on_break'));ASSERT (SELECT status='checked_out' FROM public.dealer_attendance WHERE id='${f.first}');`);await barrier(acquisition);
  child.stdin.write('COMMIT;\n');const a=JSON.parse(await acquisition.done);
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE attendance_id='${f.first}' AND released_at IS NULL AND status IN('assigned','on_break');`),'0');
  assert.equal(sql(`SELECT status FROM public.dealer_attendance WHERE id='${f.first}';`),'checked_out');
  proof.orders.push({name:'checkout_commit_before_acquisition',actual_lock:true,holder:departed,waiter:a,waiter_postcondition_in_transaction:true,waiter_business_rolled_back:true});
  const afterFirst=fingerprint();
  // Acquisition wins in its uncommitted transaction; checkout waits on incoming
  // attendance. Rollback keeps the newly scoped assignment fixture intact.
  child.stdin.write(`BEGIN;SET LOCAL application_name='checkout827_holder';SET LOCAL statement_timeout='15s';${serviceAuth}\n`);
  const changed=await query(swing(f.second));assert.equal(changed.outcome,'swung',JSON.stringify(changed));
  const leaving=await waiter(serviceAuth,checkout(f.second),`ASSERT (SELECT status='checked_out' FROM public.dealer_attendance WHERE id='${f.second}');ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id='${f.second}' AND released_at IS NULL AND status IN('assigned','on_break'));`);await barrier(leaving);
  child.stdin.write('ROLLBACK;\n');const b=JSON.parse(await leaving.done);assert.equal(b.data?.success,true,JSON.stringify(b));
  proof.orders.push({name:'uncommitted_acquisition_before_checkout',actual_lock:true,holder:changed,waiter:b,both_business_rolled_back:true});
  assert.equal(fingerprint(),afterFirst,'second overlap did not fully rollback');
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE id='${f.assignment}' AND attendance_id='${f.outgoing}' AND version=${expectedVersion} AND status='assigned' AND released_at IS NULL;`),'1');
  assert.equal(await query(`WITH s AS(UPDATE private.checkout827_fixture SET proof=${quote(JSON.stringify(proof))}::jsonb WHERE id AND proof IS NULL RETURNING id) SELECT to_jsonb(count(*)) FROM s`),1);
  console.log('CHECKOUT827_CANONICAL_CHECKINS_OPEN_ASSIGN_TWO_ACTUAL_SWING_CHECKOUT_OVERLAPS',JSON.stringify(proof));
 }finally{
  if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');
  await Promise.allSettled([closed,...workers.map(w=>w.done)]);
 }
}else{
try{
 child.stdin.write(`BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='2s';
 CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};
 ${candidate}
 CREATE FUNCTION pg_temp.checkout812_try(q text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE value jsonb;BEGIN
 EXECUTE q INTO value;RETURN jsonb_build_object('data',value,'error',NULL);
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('data',NULL,'error',jsonb_build_object('message',SQLERRM));END $$;
 INSERT INTO public.dealers(id,club_id,full_name) VALUES('${dealer}','${club}','LOCAL802 ROLLBACK TEST');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time)
 SELECT '${attendance}','${dealer}',shift_id,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in','available',now()-interval '9 hours'
 FROM public.dealer_attendance WHERE id='47323bd1-60a3-42a8-99c6-ede1c33f5f90';
 SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claims='{"role":"service_role"}';
 SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';
 SELECT public.transition_dealer_state('${attendance}','${releaseError?'available':preassigned?'pre_assigned':'on_break'}','LOCAL802_TEST_FIXTURE');
 ${releaseError?`
 INSERT INTO public.tournaments(id,club_id,name,status,live_status,buy_in,starting_stack)
 VALUES('${tour}','${club}','LOCAL812 RELEASE FAULT TEST','active','registering',0,20000);
 UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;
 DO $$DECLARE physical uuid;opened jsonb;BEGIN
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id='${club}' AND table_number=50;
 opened:=public.floor_open_tournament_table_v3('${tour}',physical,'manual',gen_random_uuid());ASSERT opened->>'ok'='true',opened::text;
 END $$;
 RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
 DO $$DECLARE target record;assigned jsonb;BEGIN
 SELECT * INTO STRICT target FROM public.tournament_tables WHERE tournament_id='${tour}';
 assigned:=public.worker_assign_dealer_to_session_v1('${club}',target.game_table_id,target.table_session_id,'${attendance}',now()+interval '45 minutes','LOCAL812-${attendance}');
 ASSERT assigned->>'outcome'='ok',assigned::text;
 END $$;
 CREATE FUNCTION pg_temp.checkout812_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF OLD.attendance_id='${attendance}'::uuid AND NEW.status='completed' THEN RAISE EXCEPTION 'LOCAL812_RELEASE_FAILED';END IF;RETURN NEW;END $$;
 CREATE TRIGGER checkout812_release_fault BEFORE UPDATE ON public.dealer_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.checkout812_fault();

 `:preassigned?`UPDATE public.dealer_attendance SET pre_assigned_table_id=(SELECT id FROM public.game_tables WHERE club_id='${club}' AND table_number=7),pre_assigned_at=now() WHERE id='${attendance}';`
 :`INSERT INTO public.dealer_breaks(id,attendance_id,club_id,break_start,expected_duration_minutes)
 VALUES('${breakId}','${attendance}','${club}',now()-interval '30 minutes',30);`}
 SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claims='{"role":"service_role"}';
 SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET LOCAL ROLE ${role};\n`);
 const clock=await query(`SELECT jsonb_build_object('now',(extract(epoch FROM now())*1000)::bigint)`);
 const cutoff=Number(clock.now);
 if(atomicCandidate&&!edgeAtomic){
  const proof=()=>query(`SELECT jsonb_build_array(
   (SELECT to_jsonb(a) FROM public.dealer_attendance a WHERE id='${attendance}'),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE attendance_id='${attendance}'),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_breaks a WHERE attendance_id='${attendance}'),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a WHERE entity_id::text='${attendance}' AND action='checkout_dealer'),
   (SELECT to_jsonb(r) FROM private.dealer_checkout_receipts_v1 r WHERE attendance_id='${attendance}'))`);
  // Private metadata proof uses postgres, never a browser/service grant.
  child.stdin.write('RESET ROLE;\n');const beforeFault=await proof();child.stdin.write(`SET LOCAL ROLE ${role};\n`);
  const command=`SELECT public.operator_checkout_dealer_attendance_v1('${actor}','${attendance}')`;
  const failed=await query(`SELECT pg_temp.checkout812_try(${quote(command)})`);
  assert.equal(failed.data,null);assert.equal(failed.error.message,'LOCAL812_RELEASE_FAILED');
  child.stdin.write('RESET ROLE;\n');assert.deepEqual(await proof(),beforeFault,'failed release must rollback state, time, audit and receipt together');
  child.stdin.write('DROP TRIGGER checkout812_release_fault ON public.dealer_assignments;\n');
  // Both faults happen AFTER the assignment/state updates. The SQL exception
  // must undo the entire function call, not leave a checkout without its proof.
  for(const table of ['public.audit_logs','private.dealer_checkout_receipts_v1']){
   const fault=table==='public.audit_logs'?'AUDIT':'RECEIPT';
   child.stdin.write(`CREATE OR REPLACE FUNCTION pg_temp.checkout813_insert_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    IF ${fault==='AUDIT'?`NEW.entity_id::text='${attendance}' AND NEW.action='checkout_dealer'`:`NEW.attendance_id='${attendance}'::uuid`} THEN RAISE EXCEPTION 'LOCAL813_${fault}_FAILED';END IF;RETURN NEW;END $$;
    CREATE TRIGGER checkout813_insert_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.checkout813_insert_fault();SET LOCAL ROLE ${role};\n`);
   const rejected=await query(`SELECT pg_temp.checkout812_try(${quote(command)})`);
   assert.equal(rejected.data,null);assert.equal(rejected.error.message,`LOCAL813_${fault}_FAILED`);
   child.stdin.write('RESET ROLE;\n');assert.deepEqual(await proof(),beforeFault,`${fault} failure left partial checkout facts`);
   child.stdin.write(`DROP TRIGGER checkout813_insert_fault ON ${table};\n`);
  }
  child.stdin.write(`SET LOCAL ROLE ${role};\n`);
  const result=await query(command);assert.equal(result.success,true);assert.equal(result.core_version,1);assert.equal(result.total_hours,9);
  const receipt=await query(`SELECT public.get_dealer_checkout_receipt_v1('${actor}','${attendance}')`);assert.equal(receipt.status,'receipt_found');assert.deepEqual(receipt.result,result);
  child.stdin.write('RESET ROLE;\n');const after=await proof();child.stdin.write(`SET LOCAL ROLE ${role};\n`);
  const replay=await query(command);assert.equal(replay.idempotent,true);assert.deepEqual({...replay,idempotent:false},result);
  child.stdin.write('RESET ROLE;\n');assert.deepEqual(await proof(),after,'replay changed saved checkout');child.stdin.write(`SET LOCAL ROLE ${role};\n`);
  assert.equal(after[0].status,'checked_out');assert.equal(after[0].current_state,'checked_out');assert.equal(after[0].total_worked_minutes_today,540);assert.equal(after[0].overtime_minutes,60);
  assert.ok(after[1].every(a=>a.status==='completed'&&a.released_at));assert.equal(after[3].length,1);assert.equal(after[4].actor_id,actor);
  // A receipt is not evidence that a different later state is still correct.
  // Tampering is a rollback-only fault, never a historical payroll correction.
  child.stdin.write(`RESET ROLE;SAVEPOINT checkout813_drift;
   UPDATE public.dealer_attendance SET total_worked_minutes_today=total_worked_minutes_today+1 WHERE id='${attendance}';SET LOCAL ROLE ${role};\n`);
  for(const name of ['operator_checkout_dealer_attendance_v1','get_dealer_checkout_receipt_v1']){
   const drift=await query(`SELECT pg_temp.checkout812_try(${quote(`SELECT public.${name}('${actor}','${attendance}')`)})`);
   assert.equal(drift.data,null,`${name} accepted attendance facts that differ from saved receipt`);
   assert.equal(drift.error.message,'DEALER_CHECKOUT_RECEIPT_STATE_CHANGED');
  }
  child.stdin.write('ROLLBACK TO SAVEPOINT checkout813_drift;RELEASE SAVEPOINT checkout813_drift;\n');
  const denied=await query(`SELECT pg_temp.checkout812_try(${quote(`SELECT public.operator_checkout_dealer_attendance_v1('675fe35e-60a8-4452-bb90-e79486d54da6','${attendance}')`)})`);
  assert.equal(denied.data,null);assert.equal(denied.error.message,'DEALER_CHECKOUT_FORBIDDEN');
  child.stdin.write(`SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"675fe35e-60a8-4452-bb90-e79486d54da6"}';\n`);
  const foreign=await query(`SELECT pg_temp.checkout812_try(${quote(`SELECT public.operator_checkout_dealer_attendance_v1('675fe35e-60a8-4452-bb90-e79486d54da6','${attendance}')`)})`);
  assert.equal(foreign.data,null);assert.equal(foreign.error.message,'DEALER_CHECKOUT_FORBIDDEN');
  child.stdin.write(`SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';RESET ROLE;SET LOCAL ROLE authenticated;\n`);
  const browserDenied=await query(`SELECT pg_temp.checkout812_try(${quote(command)})`);assert.equal(browserDenied.data,null);assert.match(browserDenied.error.message,/permission denied for function/);
  child.stdin.write(`RESET ROLE;SET LOCAL ROLE ${role};\n`);
  const directPrivate=await query(`SELECT pg_temp.checkout812_try('SELECT count(*) FROM private.dealer_checkout_receipts_v1')`);assert.equal(directPrivate.data,null);assert.match(directPrivate.error.message,/permission denied/);
  const breakDealer=randomUUID(),breakAttendance=randomUUID();
  child.stdin.write(`RESET ROLE;
   INSERT INTO public.dealers(id,club_id,full_name) VALUES('${breakDealer}','${club}','LOCAL812 BREAK ROLLBACK TEST');
   INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,current_state,check_in_time)
    SELECT '${breakAttendance}','${breakDealer}',shift_id,shift_date,'checked_in','available',now()-interval '9 hours' FROM public.dealer_attendance WHERE id='${attendance}';
   SELECT public.transition_dealer_state('${breakAttendance}','on_break','LOCAL812_TEST_FIXTURE');
   INSERT INTO public.dealer_breaks(attendance_id,club_id,break_start,break_end,expected_duration_minutes) VALUES
    ('${breakAttendance}','${club}',now()-interval '90 minutes',now()-interval '60 minutes',30),
    ('${breakAttendance}','${club}',now()-interval '30 minutes',NULL,30);
   SET LOCAL ROLE ${role};\n`);
  const breakResult=await query(`SELECT public.operator_checkout_dealer_attendance_v1('${actor}','${breakAttendance}')`);assert.equal(breakResult.success,true);assert.equal(breakResult.total_hours,8);
  const breakFacts=await query(`SELECT jsonb_build_object('worked',total_worked_minutes_today,'ot',overtime_minutes,'openBreaks',(SELECT count(*) FROM public.dealer_breaks WHERE attendance_id='${breakAttendance}' AND break_end IS NULL)) FROM public.dealer_attendance WHERE id='${breakAttendance}'`);
  assert.deepEqual(breakFacts,{worked:480,ot:0,openBreaks:0});
  console.log('CHECKOUT812_CANDIDATE_ATOMIC_RELEASE_FAULT_FULL_STATE_ROLLBACK_SUCCESS_RECEIPT_REPLAY_SCOPE_PASS');
 }else{
 const rpcNames=[];
 let loseNextResponse=lostCoreResponse;
 const admin={rpc:async(name,a)=>{
  if(name==='is_club_dealer_control'){
   assert.equal(a._club_id,club);assert.ok([actor,'675fe35e-60a8-4452-bb90-e79486d54da6'].includes(a._user_id));
   return query(`SELECT pg_temp.checkout812_try(${quote(`SELECT to_jsonb(public.is_club_dealer_control('${a._user_id}','${club}'))`)})`);
  }
  assert.ok(['operator_checkout_dealer_attendance_v1','get_dealer_checkout_receipt_v1'].includes(name));
  assert.equal(a.p_attendance_id,attendance);assert.equal(a.p_actor_id,actor);rpcNames.push(name);
  const response=await query(`SELECT pg_temp.checkout812_try(${quote(`SELECT public.${name}('${actor}','${attendance}')`)})`);
  if(name==='operator_checkout_dealer_attendance_v1'&&loseNextResponse){loseNextResponse=false;assert.equal(response.error,null);return {data:null,error:{message:'LOCAL813 response lost after SQL completed'}};}
  return response;
 },from(table){
  assert.ok(['dealer_attendance','dealers','club_settings'].includes(table),'unexpected table/write path '+table);
  let columns='*',filters=[];
  const b={select:c=>{assert.ok(c==='id, dealer_id, dealers!inner(club_id)'||/^[a-z_, ]+$/.test(c));columns=c;return b;},eq:(k,v)=>{assert.match(k,/^[a-z_]+$/);filters.push(k+'='+quote(v));return b;},
   in:(k,values)=>{assert.equal(table,'dealer_attendance');assert.equal(k,'id');assert.deepEqual(Array.from(values),[attendance]);return b;},
   then:async(resolve,reject)=>{try{
    assert.equal(columns,'id, dealer_id, dealers!inner(club_id)');
    const rows=await query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'dealer_id',a.dealer_id,'dealers',jsonb_build_object('club_id',d.club_id))),'[]') FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id='${attendance}'`);
    return resolve({data:rows,error:null});
   }catch(error){return reject(error);}},
   async single(){const rows=await query(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT ${columns} FROM public.${table} WHERE ${filters.join(' AND ')})x`);assert.equal(rows.length,1);return {data:rows[0],error:null};},
   maybeSingle:async()=>({data:null,error:null}),
   update(){throw Error('legacy direct update forbidden');},insert(){throw Error('legacy audit insert forbidden');}};
  return b;
 }};
 let checkout,handler;
 const source=readFileSync(new URL('../../supabase/functions/checkout-dealer/index.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');
 class Clock extends Date{constructor(value){super(value??cutoff);}static now(){return cutoff;}}
 runInNewContext(ts.transpileModule(source+'\ncaptureCheckout(processOneCheckout);',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {captureCheckout:fn=>checkout=fn,Deno:{serve:fn=>handler=fn,env:{get:name=>name==='SUPABASE_URL'?'http://127.0.0.1:54329':name==='TELEGRAM_BOT_TOKEN'?'':'LOCAL_TEST_ONLY'}},Date:Clock,console,mention:()=> 'LOCAL802 TEST',pickNextDealer:async()=>null,
  createClient:()=>admin,manualDealerIntentHeaders,mapWithConcurrency,Response,
  corsHeaders:{'Access-Control-Allow-Origin':'http://127.0.0.1:5188'},jsonResponse:(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}}),
  authenticateUser:async req=>({uid:req.headers.get('x-local-test-actor')??actor})});
 const invoke=async()=>{
  if(!handlerMode)return checkout(admin,'',actor,attendance);
  const response=await handler(new Request('http://127.0.0.1/functions/v1/checkout-dealer',{method:'POST',headers:{'content-type':'application/json','x-local-test-actor':actor},body:JSON.stringify({attendance_id:attendance})}));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.results.length,1);return body.results[0];
 };
 if(handlerMode){
  const denied=await handler(new Request('http://127.0.0.1/functions/v1/checkout-dealer',{method:'POST',headers:{'content-type':'application/json','x-local-test-actor':'675fe35e-60a8-4452-bb90-e79486d54da6'},body:JSON.stringify({attendance_id:attendance})}));
  assert.equal(denied.status,403,await denied.text());assert.deepEqual(rpcNames,[],'foreign caller reached checkout mutation');
 }
 const beforeEdge=await query(`SELECT to_jsonb(a) FROM public.dealer_attendance a WHERE id='${attendance}'`);
 const result=await invoke();
 if(releaseError){
  const observed=await query(`SELECT jsonb_build_object('attendanceClosed',(SELECT status='checked_out' AND current_state='checked_out' FROM public.dealer_attendance WHERE id='${attendance}'),'liveAssignments',(SELECT count(*) FROM public.dealer_assignments WHERE attendance_id='${attendance}' AND released_at IS NULL))`);
  console.log('CHECKOUT813_ATOMIC_EDGE_RELEASE_SQL_ERROR_OBSERVED',JSON.stringify({returnedSuccess:result.success,...observed}));
  assert.equal(result.success,false);assert.equal(observed.attendanceClosed,false);assert.equal(observed.liveAssignments,1);
  assert.deepEqual(await query(`SELECT to_jsonb(a) FROM public.dealer_attendance a WHERE id='${attendance}'`),beforeEdge);
  child.stdin.write('RESET ROLE;\n');
  assert.deepEqual(await query(`SELECT jsonb_build_object('audits',(SELECT count(*) FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text='${attendance}'),'receipts',(SELECT count(*) FROM private.dealer_checkout_receipts_v1 WHERE attendance_id='${attendance}'))`),{audits:0,receipts:0});
  console.log('CHECKOUT813_ACTUAL_EDGE_SQL_RELEASE_FAULT_NO_PARTIAL_STATE_PASS');
 }else{
  assert.equal(result.success,true);assert.equal(result.total_hours,preassigned?9:8.5);
  const state=await query(`SELECT jsonb_build_object('status',status,'state',current_state,'worked',total_worked_minutes_today,'ot',overtime_minutes,'checkout',check_out_time IS NOT NULL,'preassignmentCleared',pre_assigned_table_id IS NULL AND pre_assigned_at IS NULL) FROM public.dealer_attendance WHERE id='${attendance}'`);
  assert.deepEqual(state,{status:'checked_out',state:'checked_out',worked:preassigned?540:510,ot:preassigned?60:30,checkout:true,preassignmentCleared:true});
  const audit=await query(`SELECT jsonb_build_object('count',count(*),'actorOk',bool_and(actor_id='${actor}'::uuid),'clubOk',bool_and(club_id='${club}'::uuid)) FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text='${attendance}'`);
  assert.deepEqual(audit,{count:1,actorOk:true,clubOk:true});
  if(lostCoreResponse){
   assert.equal(result.recovered,true);assert.equal(result.idempotent,true);
   assert.deepEqual(rpcNames,['operator_checkout_dealer_attendance_v1','get_dealer_checkout_receipt_v1']);
   const replay=await invoke();assert.equal(replay.success,true);assert.equal(replay.idempotent,true);
   assert.deepEqual(await query(`SELECT jsonb_build_object('status',status,'state',current_state,'worked',total_worked_minutes_today,'ot',overtime_minutes,'checkout',check_out_time IS NOT NULL,'preassignmentCleared',pre_assigned_table_id IS NULL AND pre_assigned_at IS NULL) FROM public.dealer_attendance WHERE id='${attendance}'`),state);
   assert.equal(await query(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE action='checkout_dealer' AND entity_id::text='${attendance}'`),1);
  }
  console.log(lostCoreResponse?'CHECKOUT813_ACTUAL_EDGE_SQL_RESPONSE_LOSS_RECEIPT_RECOVERY_EXPLICIT_REPLAY_NO_DUPLICATE_PASS':preassigned?'CHECKOUT813_ACTUAL_EDGE_SQL_PREASSIGNED_CHECKOUT_540M_OT60_PASS':'CHECKOUT813_ACTUAL_EDGE_SQL_OPEN_BREAK_510M_OT30_PASS');
 }
 if(handlerMode)console.log('CHECKOUT813_ACTUAL_DENO_HANDLER_NATIVE_SCOPE_DENIAL_AND_OWNER_RESULT_PASS_AUTH_MODELED_NOT_HOSTED');

 }
}finally{
 if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');
 try{await closed;}finally{
  assert.equal(fingerprint(),before);assert.equal(sql(`SELECT count(*) FROM pg_roles WHERE rolname='${role}';`),'0');
  if(atomicCandidate)assert.equal(sql("SELECT to_regclass('private.dealer_checkout_receipts_v1') IS NULL AND to_regprocedure('public.operator_checkout_dealer_attendance_v1(uuid,uuid)') IS NULL;"),'t');
  console.log('CHECKOUT802_FULL_ROLLBACK_RETAINED_FACTS_UNCHANGED_TEMP_ROLE_GONE_PASS');
 }
}
}
