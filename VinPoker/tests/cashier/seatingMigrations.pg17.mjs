import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const database=process.env.PGDATABASE;
assert.ok(['vinpoker_ops_cash115_qualified','vinpoker_ops_cash115_qualified_b','vinpoker_ops_cash115_qualified_c','vinpoker_ops_cash116_qualified'].includes(database));
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,database);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const quote=s=>`'${s.replaceAll("'","''")}'`;
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),database+'|127.0.0.1|55441|17');
const dir=sql('SHOW data_directory');
assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const steps=process.argv.includes('--only123')?[
 ['20270128000123_tournament_close_official_results_v1.sql','floor_private.felt_tournament_close_blockers_v1(uuid)','floor_private.felt_finalize_official_results_at_close_v1()'],
]:process.argv.includes('--only122')?[
 ['20270128000122_floor_restore_provisional_history_order_v1.sql','floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)',null],
]:process.argv.includes('--only117')?[
 ['20270128000117_cashier_correction_alert_seating_fence_v1.sql','floor_private.pick_cashier_canonical_seat_v1(uuid,text)',null],
]:process.argv.includes('--only116')?[
 ['20270128000116_floor_restore_pending_reentry_fence_v1.sql','floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)',null],
]:[
 ['20270128000113_cashier_canonical_paid_seating_v1.sql','public.confirm_registration_and_assign_seat(uuid,uuid,text)','floor_private.pick_cashier_canonical_seat_v1(uuid,text)'],
 ['20270128000114_cashier_canonical_reentry_seating_v1.sql','public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)',null],
 ['20270128000115_cashier_server_priced_reentry_v1.sql',null,'public.cashier_create_app_reentry_v1(uuid,uuid)'],
];
for(const [filename,target,added] of steps){
 const migration=readFileSync(new URL('../../supabase/migrations/'+filename,import.meta.url),'utf8');
 assert.match(migration,/COMMIT;\s*$/);
 const before=target?sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid=${quote(target)}::regprocedure;`):null;
 const beforeDefinition=filename.includes('00123')?sql(`SELECT replace(pg_get_functiondef(${quote(target)}::regprocedure),chr(13),'');`):null;
 if(added)assert.equal(sql(`SELECT to_regprocedure(${quote(added)}) IS NULL;`),'t','requires fresh pre-chain clone');
 const guarded=[...(target?[target]:[]),...(filename.includes('00114')||filename.includes('00115')?['floor_private.pick_cashier_canonical_seat_v1(uuid,text)']:[]),...(filename.includes('00115')?['public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)']:[]),...(filename.includes('00116')?['public.cashier_create_app_reentry_v1(uuid,uuid)']:[]),...(filename.includes('00123')?['public.close_tournament(uuid,text)','public.finalize_tournament_results(uuid)']:[])];
 const unchangedDependencies=filename.includes('00123')?guarded.filter(name=>name!==target).map(name=>[name,sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid=${quote(name)}::regprocedure;`)]):[];
 for(const guardedTarget of guarded){
  const guardedBefore=sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid=${quote(guardedTarget)}::regprocedure;`);
  // Unknown bodies must fail the digest precondition, not get silently replaced.
  const drift=`BEGIN;DO $$ DECLARE d text:=replace(pg_get_functiondef(${quote(guardedTarget)}::regprocedure),chr(13),''); changed text;BEGIN
changed:=replace(d,E'BEGIN\n',E'BEGIN\n-- TEST_UNKNOWN_CATALOG_BODY\n');
IF changed=d THEN RAISE EXCEPTION 'fault_injection_anchor_missing';END IF;
EXECUTE changed;
IF md5(replace(pg_get_functiondef(${quote(guardedTarget)}::regprocedure),chr(13),''))=md5(d) THEN RAISE EXCEPTION 'fault_injection_did_not_change_body';END IF;
END $$;`;
  const r=spawnSync(binary,[...prefix,...flags],{input:drift+migration,encoding:'utf8',timeout:30000});
  assert.notEqual(r.status,0,'unknown-body migration unexpectedly applied');assert.match(r.stderr,/drift/);
  assert.equal(sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid=${quote(guardedTarget)}::regprocedure;`),guardedBefore,'failed apply must leave old body/metadata');
  if(added)assert.equal(sql(`SELECT to_regprocedure(${quote(added)}) IS NULL;`),'t');
 }
 const catalogFingerprint=`SELECT md5(jsonb_object_agg(oid::text,to_jsonb(p))::text) FROM pg_proc p WHERE pronamespace IN ('public'::regnamespace,'floor_private'::regnamespace);`;
 const original=sql(catalogFingerprint);
 sql(migration.replace(/COMMIT;\s*$/,'ROLLBACK;'));
 assert.equal(sql(catalogFingerprint),original,'DDL rollback must restore all source/config/ACL/owner rows');
 if(added)assert.equal(sql(`SELECT to_regprocedure(${quote(added)}) IS NULL;`),'t');
 sql(migration);
 if(target){const after=JSON.parse(sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid=${quote(target)}::regprocedure;`)),old=JSON.parse(before);
  assert.notEqual(after.prosrc,old.prosrc);after.prosrc=old.prosrc;assert.deepEqual(after,old,'only reviewed body may change');}
 if(added){
  for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_function_privilege('${role}',${quote(added)},'EXECUTE');`),'f');
  assert.equal(sql(`SELECT has_function_privilege('service_role',${quote(added)},'EXECUTE');`),filename.includes('00115')?'t':'f');
  assert.equal(sql(`SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=${quote(added)}::regprocedure;`),'t');
 }
 if(filename.includes('00123')){
  for(const [name,old] of unchangedDependencies)assert.equal(sql(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid=${quote(name)}::regprocedure;`),old,'close financial calculation and ranking algorithm must not change');
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','floor_private.felt_official_results_close_status_v1(uuid)','EXECUTE');`),'f');
  const qualified=sql(catalogFingerprint);
  const compensated=sql(`BEGIN;${beforeDefinition};DROP TRIGGER trg_felt_official_results_close_v1 ON public.tournament_close_report;
   DROP FUNCTION floor_private.felt_finalize_official_results_at_close_v1();DROP FUNCTION floor_private.felt_official_results_close_status_v1(uuid);${catalogFingerprint}ROLLBACK;`);
  assert.equal(compensated,original,'recorded blocker plus removal of only new objects must recover old catalog');assert.equal(sql(catalogFingerprint),qualified,'compensation rehearsal rollback must retain qualified catalog');
 }
 console.log(filename+': FRESH_DDL_ROLLBACK_ACL_PASS + GUARDED_BODY_DRIFT_REJECTIONS='+guarded.length+(target?' + METADATA_PASS':''));
}
