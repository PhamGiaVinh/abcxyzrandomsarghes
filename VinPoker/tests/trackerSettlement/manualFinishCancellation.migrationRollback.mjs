import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_finish97_ci');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function run(sql){return spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});}
function query(sql){const result=run(sql);assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
assert.equal(query("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND inet_server_addr()='127.0.0.1'::inet;"),'t');
const snapshot=()=>query(`SELECT md5(coalesce(string_agg(p.oid::text||pg_get_functiondef(p.oid)
 ||coalesce(p.proacl::text,'')||coalesce(p.proconfig::text,'')||p.proowner::text,'' ORDER BY p.oid),''))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','floor_private') AND p.prokind='f';`);
assert.equal(query("SELECT to_regprocedure('public.cancel_tracker_manual_finish_v1(jsonb)') IS NULL;"),'t');
const before=snapshot();
const migration=readFileSync('supabase/migrations/20270128000097_tracker_manual_finish_cancellation_receipt_v1.sql','utf8').replaceAll('\r\n','\n');
assert.equal((migration.match(/^COMMIT;$/gm)??[]).length,1);
const fault=migration.replace(/^COMMIT;$/m,()=>"DO $$ BEGIN RAISE EXCEPTION 'finish97_injected_precommit_fault'; END $$;\nCOMMIT;");
const failed=run(fault);assert.notEqual(failed.status,0);assert.match(failed.stderr,/finish97_injected_precommit_fault/);
assert.equal(snapshot(),before,'DDL failure changed exact function definitions/owners/ACL/config');
assert.equal(query("SELECT to_regprocedure('public.cancel_tracker_manual_finish_v1(jsonb)') IS NULL;"),'t');
console.log('MANUAL_FINISH97_PRECOMMIT_EXACT_FUNCTION_ACL_ROLLBACK_PASS');
if(process.argv.includes('--apply-after-rollback')){
 const applied=run(migration);assert.equal(applied.status,0,applied.stderr);
 assert.equal(query("SELECT has_function_privilege('authenticated','public.cancel_tracker_manual_finish_v1(jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.cancel_tracker_manual_finish_v1(jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.cancel_tracker_manual_finish_v1(jsonb)','EXECUTE');"),'t');
 console.log('MANUAL_FINISH97_APPLY_ACL_POSTCHECK_PASS');
}
