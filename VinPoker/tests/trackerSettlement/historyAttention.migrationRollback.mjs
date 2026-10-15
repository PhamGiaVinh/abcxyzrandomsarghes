import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_history98_ci','vinpoker_ops_history98_rollback'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function run(sql){return spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});}
function query(sql){const r=run(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(query("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AND inet_server_addr()='127.0.0.1'::inet;"),'t');
const signature='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)';
const snapshot=()=>query(`SELECT pg_get_functiondef(oid)||coalesce(proacl::text,'')||coalesce(proconfig::text,'')||proowner::text FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
const before=snapshot();const metadata=()=>query(`SELECT coalesce(proacl::text,'')||coalesce(proconfig::text,'')||proowner::text FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
const beforeMetadata=metadata();
const migration=readFileSync('supabase/migrations/20270128000098_tracker_public_history_attention_state_v1.sql','utf8').replaceAll('\r\n','\n');
assert.equal((migration.match(/^COMMIT;$/gm)??[]).length,1);
const failed=run(migration.replace(/^COMMIT;$/m,()=>"DO $$ BEGIN RAISE EXCEPTION 'history98_injected_precommit_fault'; END $$;\nCOMMIT;"));
assert.notEqual(failed.status,0);assert.match(failed.stderr,/history98_injected_precommit_fault/);
assert.equal(snapshot(),before,'failed migration changed definition/ACL/owner/config');
console.log('HISTORY98_EXACT_DEFINITION_ACL_ROLLBACK_PASS');
if(process.argv.includes('--apply-after-rollback')){
 const applied=run(migration);assert.equal(applied.status,0,applied.stderr);
 assert.equal(metadata(),beforeMetadata);assert.notEqual(snapshot(),before);
 console.log('HISTORY98_APPLY_PRESERVES_EXACT_METADATA_PASS');
}
