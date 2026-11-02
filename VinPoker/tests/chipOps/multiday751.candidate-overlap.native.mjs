import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_MULTIDAY751_NATIVE,'1');
const installedMode=process.argv.includes('--installed-close-day');
const operation=installedMode?'installed-close-day':process.argv.includes('--authorized-close-day')?'authorized-close-day':process.argv.includes('--seal-day')?'seal-day':process.argv.includes('--seal-bag')?'seal-bag':process.argv.includes('--close-day')?'close-day':null;
assert.ok(process.argv.filter(x=>['--seal-day','--seal-bag','--close-day','--authorized-close-day','--installed-close-day'].includes(x)).length<=1);
const bagWait=process.argv.includes('--bag-wait')||operation==='seal-bag';
const resumeBagWait=process.argv.includes('--resume-bag-wait');
assert.ok(!resumeBagWait||bagWait);
const checkpoint=installedMode?'759':operation==='authorized-close-day'?'757':operation==='seal-day'?'754':operation==='seal-bag'?'755':operation==='close-day'?'756':resumeBagWait?'753':bagWait?'752':'751';
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql(`SELECT to_regclass('floor_private.multiday${checkpoint}_function_backup') IS NULL AND to_regclass('floor_private.multiday${checkpoint}_authority_wait_v1') IS NULL;`),'t','consumed qualification; preserve evidence');
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state<>'idle' AND backend_type='client backend';"),'0','other local writer active');
const identity=`SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl,proconfig,prosecdef,md5(pg_get_functiondef(oid))) ORDER BY oid) FROM pg_proc WHERE oid IN(
 'public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure,
 'public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)'::regprocedure,
 'public.multi_day_close_bagging_v1(uuid,integer,uuid)'::regprocedure);`;
const original=sql(identity);
if(operation==='authorized-close-day'||installedMode){
 assert.equal(sql("SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND multi_day_revision=2 AND sealed AND total_value=20000 AND bag_code='LOCAL752-CANONICAL';"),'1','continue canonical sealed bag');
}else if(operation){
 assert.equal(sql("SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND multi_day_revision=1 AND NOT sealed AND total_value=20000 AND bag_code='LOCAL752-CANONICAL';"),'1','continue canonical bag, never reset');
 if(operation==='close-day'){
  sql(`BEGIN;CREATE TEMP TABLE gate756_before AS SELECT * FROM public.multi_day_package_release_v1;
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(allowed_club_ids||ARRAY['2d6ff316-9ca6-4aa5-8c6e-7bc9982f4abd'::uuid])x) WHERE id;
 SET LOCAL request.jwt.claim.sub='fe1d1df9-de0f-4ae7-94a9-f880fc60637c';
 SET LOCAL request.jwt.claims='{"sub":"fe1d1df9-de0f-4ae7-94a9-f880fc60637c","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT public.multi_day_seal_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93',1,'4c848a73-736e-4333-ad51-b8301e0319ee');
 RESET ROLE;UPDATE public.multi_day_package_release_v1 g SET enabled=b.enabled,allowed_club_ids=b.allowed_club_ids,updated_at=b.updated_at FROM gate756_before b WHERE g.id=b.id;COMMIT;`);
  assert.equal(sql("SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND multi_day_revision=2 AND sealed AND total_value=20000;"),'1');
  console.log('MULTIDAY756_CANONICAL_OWNER_SEAL_RECORDED_KEEP_HISTORY');
 }
}else if(resumeBagWait){
 assert.equal(sql("SELECT to_regclass('floor_private.multiday752_function_backup') IS NOT NULL AND to_regclass('floor_private.multiday752_authority_wait_v1') IS NULL;"),'t','resume only observed pre-probe failure; no consumed overlap');
 assert.equal(sql("SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND multi_day_revision=1 AND NOT sealed AND total_value=20000 AND bag_code='LOCAL752-CANONICAL';"),'1');
}else if(bagWait){
 assert.equal(sql("SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7';"),'0','do not reset/recreate prior bag');
 sql(`BEGIN;CREATE TEMP TABLE gate752_before AS SELECT * FROM public.multi_day_package_release_v1;
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(allowed_club_ids||ARRAY['2d6ff316-9ca6-4aa5-8c6e-7bc9982f4abd'::uuid])x) WHERE id;
 SET LOCAL request.jwt.claim.sub='fe1d1df9-de0f-4ae7-94a9-f880fc60637c';
 SET LOCAL request.jwt.claims='{"sub":"fe1d1df9-de0f-4ae7-94a9-f880fc60637c","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT public.multi_day_record_bag_v1('a0736301-cbd6-41bf-b5ce-2bcb1610a1b7','51475c20-f444-4daf-9eb0-026d531d6b93','LOCAL752-CANONICAL',20000,0,'484f87b6-f437-4bfc-b604-5b4ed354bfad');
 RESET ROLE;UPDATE public.multi_day_package_release_v1 g SET enabled=b.enabled,allowed_club_ids=b.allowed_club_ids,updated_at=b.updated_at FROM gate752_before b WHERE g.id=b.id;COMMIT;`);
 assert.equal(sql("SELECT count(*) FROM public.chip_bag WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND multi_day_revision=1 AND NOT sealed AND total_value=20000;"),'1');
 console.log('MULTIDAY752_CANONICAL_OWNER_BAG_RECORDED_KEEP_HISTORY');
}
if(!installedMode)sql(`BEGIN;CREATE TABLE floor_private.multiday${checkpoint}_function_backup AS SELECT oid,proowner,proacl,proconfig,prosecdef,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid IN(
 'public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure,
 'public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)'::regprocedure,
 'public.multi_day_close_bagging_v1(uuid,integer,uuid)'::regprocedure);
 ALTER TABLE floor_private.multiday${checkpoint}_function_backup ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.multiday${checkpoint}_function_backup FROM PUBLIC,anon,authenticated,service_role;COMMIT;`);
const candidate=readFileSync(new URL('./multiday750.authority-candidate.rollback.sql',import.meta.url),'utf8');
const boundary=candidate.indexOf('UPDATE public.multi_day_package_release_v1');
assert.ok(boundary>0);
let installed=false;
try{
 if(installedMode){
  assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_close_bagging_v1(uuid,integer,uuid)'::regprocedure));"),'94a1f794956258bc41f2998d41b4bb42');
  assert.equal(sql("SELECT to_regclass('floor_private.multiday758_function_backup') IS NOT NULL;"),'t');
 }else if(operation==='authorized-close-day')sql(readFileSync(new URL('../../supabase/migrations/20270128000286_multiday_bag_postwait_authority_v1.sql',import.meta.url),'utf8'));
 else sql(candidate.slice(0,boundary)+'COMMIT;');
 installed=!installedMode;
 const candidateIdentity=sql(identity);
 if(installedMode)assert.equal(candidateIdentity,original);else assert.notEqual(candidateIdentity,original);
 const digest=sql("SELECT md5(pg_get_functiondef('public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure));");
 console.log(`MULTIDAY${checkpoint}_${installedMode?'INSTALLED':'TEMP_CANDIDATE'}_IDENTITY`,candidateIdentity);
 process.env.VINPOKER_MULTIDAY749_NATIVE='1';
 process.env[`VINPOKER_MULTIDAY${checkpoint}_NATIVE`]='1';
 let probe=readFileSync(new URL('./multiday749.authority-wait.native.mjs',import.meta.url),'utf8')
  .replaceAll('multiday749',`multiday${checkpoint}`).replaceAll('MULTIDAY749',`MULTIDAY${checkpoint}`).replaceAll('LOCAL749',`LOCAL${checkpoint}`)
  .replaceAll('5938545dae6c953a7cabe3b090f0b9b2',digest);
 if(bagWait||operation){
  const count="SELECT count(*) FROM public.chip_bag WHERE tournament_id='${flight}';`),'0'";
  assert.equal(probe.split(count).length-1,2,'bag count guard seam drift');
  probe=probe.replaceAll(count,"SELECT count(*) FROM public.chip_bag WHERE tournament_id='${flight}';`),'1'");
  if(bagWait)probe=probe.replace("SELECT tournament_id FROM public.day_close WHERE tournament_id='${flight}' AND day_number=1 FOR UPDATE;","SELECT tournament_id FROM public.chip_bag WHERE tournament_id='${flight}' AND day_number=1 FOR UPDATE;");
  if(operation){
   const call="SELECT public.multi_day_record_bag_v1('${flight}','${player}','LOCAL"+checkpoint+"-AUTH-WAIT',20000,0,'${request}');";
   assert.ok(probe.includes(call),'writer call seam drift');
   const close=operation.includes('close');
   const version=close?sql("SELECT version FROM public.day_close WHERE tournament_id='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7' AND day_number=1;"):null;
   const replacement=close?"SELECT public.multi_day_close_bagging_v1('${flight}',"+version+",'${request}');":"SELECT public.multi_day_seal_bag_v1('${flight}','${player}',1,'${request}');";
   probe=probe.replace(call,replacement).replace("includes('multi_day_bag_actor_not_allowed')",`includes('${close?'multi_day_close_actor_not_allowed':'multi_day_bag_seal_actor_not_allowed'}')`);
   if(operation==='authorized-close-day'){
    const revoke="DELETE FROM public.club_chip_masters WHERE club_id='${club}' AND user_id='${actor}';COMMIT;";
    assert.ok(probe.includes(revoke));
    probe=probe.replace(revoke,'COMMIT;')
     .replace("SELECT public.is_club_chip_master('${actor}','${club}');`),'f'","SELECT public.is_club_chip_master('${actor}','${club}');`),'t'");
    const oracle=probe.indexOf('assert.ok(result?.error?');assert.ok(oracle>0);
    probe=probe.slice(0,oracle)+"assert.equal(result?.rows?.[0]?.status,'locked');assert.equal(result.rows[0].ok,true);assert.equal(result.rows[0].countedTotal,20000);assert.equal(result.rows[0].bagCount,1);\n";
    probe=probe.replace('authorityRevoked:true','authorityRevoked:false');
   }
  }else probe=probe.replace(`'LOCAL${checkpoint}-AUTH-WAIT',20000,0,`,`'LOCAL${checkpoint}-AUTH-WAIT',20000,1,`);
  probe=probe.replace("'multi_day_bag_requests_v1','cashier_buyin_movements'","'multi_day_bag_requests_v1','multi_day_close_requests_v1','cashier_buyin_movements'");
 }
 await import('data:text/javascript;base64,'+Buffer.from(probe).toString('base64'));
 assert.equal(sql(identity),candidateIdentity,'candidate changed during overlap');
 console.log(`MULTIDAY${checkpoint}_ACTUAL_${bagWait?'BAG':'DAY'}_WAIT_${operation==='authorized-close-day'?'AUTHORIZED_ACTOR_ACCEPTED':'REVOKED_ACTOR_DENIED'}_PASS`);
}finally{
 // Always restore exact old definitions, not a synthetic roll-forward/reset.
 if(installed)sql(`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
 DO $$ DECLARE r record; BEGIN FOR r IN SELECT * FROM floor_private.multiday${checkpoint}_function_backup LOOP EXECUTE r.definition;END LOOP;END $$;COMMIT;`);
 assert.equal(sql(identity),original,'original definitions/owner/ACL/config not recovered');
 console.log(`MULTIDAY${checkpoint}_THREE_FUNCTIONS_AUTHORITY_${installedMode?'RETAINED':'RECOVERED'}`);
}
