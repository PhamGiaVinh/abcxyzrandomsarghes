import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql} from '../publicHud/nativeDb.mjs';

// Compile/ACL/recovery evidence only. This clone's service role intentionally
// lacks hosted BYPASSRLS/auth-schema permissions: no paid runtime PASS here.
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_reentry_transport_20261107a');
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),
 'vinpoker_hud_test_reentry_transport_20261107a|127.0.0.1|55441|17');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const migration=readFileSync(new URL('../../supabase/pending-migrations/20261107013500_cashier_app_reentry_transport_v1.sql',import.meta.url),'utf8');
const recovery=readFileSync(new URL('../../supabase/pending-migrations/recovery/20261107013500_cashier_app_reentry_transport_v1.rollback.sql',import.meta.url),'utf8');
const signature='public.cashier_app_reentry_transport_v1(uuid,uuid)';
const state=()=>sql(`SELECT jsonb_build_object('canonical',md5(pg_get_functiondef('public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure)),
 'registrations',(SELECT count(*) FROM public.tournament_registrations),
 'movements',(SELECT count(*) FROM public.cashier_buyin_movements),
 'notifications',(SELECT count(*) FROM public.notifications));`);
const before=state();
if(sql(`SELECT to_regprocedure('${signature}') IS NOT NULL;`)==='t')sql(recovery,{captureFailure:true});
sql(migration,{captureFailure:true});
const rejects=(query,marker)=>assert.throws(()=>sql(query,{captureFailure:true}),error=>
 String(error.stderr??'').includes(marker));
rejects(migration,'reentry_transport_signature_collision');
rejects('BEGIN;ALTER FUNCTION public.cashier_app_reentry_transport_v1(uuid,uuid) SECURITY DEFINER;\n'+recovery,
 'reentry_transport_recovery_postimage_drift');
assert.deepEqual(JSON.parse(sql(`SELECT jsonb_build_object('invoker',NOT prosecdef,'searchPath',proconfig,
 'anonymous',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),
 'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE oid='${signature}'::regprocedure;`)),
 {invoker:true,searchPath:['search_path=""'],anonymous:false,authenticated:false,service:true});
for(const role of ['anon','authenticated','postgres']){
 sql(`BEGIN;SET LOCAL ROLE ${role};DO $$ BEGIN
  BEGIN PERFORM public.cashier_app_reentry_transport_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
   RAISE EXCEPTION 'candidate_role_was_not_denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END $$;ROLLBACK;`,{captureFailure:true});
}
const denied=sql(`BEGIN;SET LOCAL ROLE service_role;
 SELECT public.cashier_app_reentry_transport_v1('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');ROLLBACK;`,{captureFailure:true});
assert.deepEqual(JSON.parse(denied),{status:404,body:{error:'Tournament not found'}});
assert.equal(state(),before,'compile/denial tests must preserve canonical source and all rows');
sql(recovery,{captureFailure:true});
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL;`),'t');
assert.equal(state(),before,'recovery must preserve source and optional notifications');
rejects('BEGIN;ALTER FUNCTION public.cashier_create_app_reentry_v1(uuid,uuid) SECURITY INVOKER;\n'+migration,
 'canonical_reentry_dependency_drift');
assert.equal(state(),before,'dependency failure must roll back without modifying canonical source');
sql(migration,{captureFailure:true});
assert.equal(state(),before,'reapply must preserve source');
console.log(JSON.stringify({kind:'REENTRY_CANDIDATE_COMPILE_ACL_RECOVERY_ONLY',passed:true,
 checks:['current-schema-compile','invoker-empty-search-path','anon-authenticated-owner-denied','service-missing-tour',
 'canonical-and-source-preserved','drop-reapply','signature-collision-denied','recovery-drift-denied',
 'canonical-security-drift-denied'],paidRuntimeVerified:false,qualification:false}));
