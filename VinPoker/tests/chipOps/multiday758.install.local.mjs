import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_MULTIDAY758_LOCAL_APPLY,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend' AND state<>'idle';"),'0');
assert.equal(sql("SELECT to_regclass('floor_private.multiday758_function_backup') IS NULL AND NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000286');"),'t','consumed/collision; do not reset');
const functions=`'public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure,'public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)'::regprocedure,'public.multi_day_close_bagging_v1(uuid,integer,uuid)'::regprocedure`;
const identity=()=>JSON.parse(sql(`SELECT jsonb_object_agg(proname,jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'hash',md5(pg_get_functiondef(oid)))) FROM pg_proc WHERE oid IN(${functions});`));
const originals={multi_day_record_bag_v1:'5938545dae6c953a7cabe3b090f0b9b2',multi_day_seal_bag_v1:'ab84f532a19974d961319fb3f64e8a0f',multi_day_close_bagging_v1:'4085443a5cb28264f71311e57681d4af'};
const finals={multi_day_record_bag_v1:'b3f7a522bb08cb27e4a60acf198bd21a',multi_day_seal_bag_v1:'22bb35dc2f42228648d8c853273ef7fe',multi_day_close_bagging_v1:'94a1f794956258bc41f2998d41b4bb42'};
const original=identity();for(const [name,hash]of Object.entries(originals))assert.equal(original[name].hash,hash);
const tables=['chip_bag','day_close','multi_day_bag_requests_v1','multi_day_close_requests_v1','cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','multi_day_package_release_v1','club_settings','club_chip_masters'];
const protectedProof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);ROLLBACK;`);
const before=protectedProof();
sql(`BEGIN;CREATE TABLE floor_private.multiday758_function_backup AS SELECT oid,proowner,proacl,proconfig,prosecdef,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid IN(${functions});ALTER TABLE floor_private.multiday758_function_backup ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.multiday758_function_backup FROM PUBLIC,anon,authenticated,service_role;COMMIT;`);
const restore=`DO $$ DECLARE r record;BEGIN FOR r IN SELECT * FROM floor_private.multiday758_function_backup LOOP EXECUTE r.definition;END LOOP;END $$;`;
let installed=false;
try{
 sql(readFileSync(new URL('../../supabase/migrations/20270128000286_multiday_bag_postwait_authority_v1.sql',import.meta.url),'utf8'));installed=true;
 const final=identity();
 for(const [name,hash]of Object.entries(finals)){
  assert.deepEqual(final[name],{...original[name],hash});
 }
 assert.equal(protectedProof(),before,'protected business/flag/role delta');
 // Exercise exact recovery body inside transaction, then roll recovery back.
 sql(`BEGIN;SET LOCAL lock_timeout='3s';${restore}
 DO $$ DECLARE r record;BEGIN FOR r IN SELECT * FROM floor_private.multiday758_function_backup LOOP
 ASSERT pg_get_functiondef(r.oid)=r.definition,'recovery body mismatch';
 ASSERT (SELECT proowner=r.proowner AND proacl IS NOT DISTINCT FROM r.proacl AND proconfig IS NOT DISTINCT FROM r.proconfig AND prosecdef=r.prosecdef FROM pg_proc WHERE oid=r.oid),'recovery authority mismatch';END LOOP;END $$;ROLLBACK;`);
 assert.deepEqual(identity(),final,'recovery test left original body installed');
 assert.equal(protectedProof(),before);
 assert.equal(sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20270128000286';"),'0');
 console.log('MULTIDAY758_LOCAL_286_INSTALLED_THREE_FUNCTIONS_AUTHORITY_EXACT_RECOVERY_QUALIFIED_PROTECTED_BUSINESS_FLAGS_ROLES_UNCHANGED_NO_LEDGER',JSON.stringify(final));
}catch(error){
 if(installed)sql(`BEGIN;SET LOCAL lock_timeout='3s';${restore}COMMIT;`);
 assert.deepEqual(identity(),original,'failure recovery did not restore original');
 assert.equal(protectedProof(),before,'failure protected proof changed');
 throw error;
}
