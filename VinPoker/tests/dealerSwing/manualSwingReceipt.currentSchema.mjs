import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_swing100_ci','vinpoker_ops_swing100_qualified'].includes(process.env.PGDATABASE));
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key]);
function sql(input,ok=true){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});
 if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);
 return r;
}
const dataDirectory=sql('SHOW data_directory').stdout.trim();
assert.ok(dataDirectory==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 || (process.env.GITHUB_ACTIONS==='true' && dataDirectory==='/var/lib/postgresql/data'));
const migration=readFileSync('supabase/migrations/20270128000100_dealer_manual_swing_receipt_v1.sql','utf8');
const writer="public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)";
const signature="public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)";
if(!process.argv.includes('--runtime-only')) {
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL`).stdout.trim(),'t');
const before=sql(`SELECT pg_get_functiondef('${writer}'::regprocedure)`).stdout;
const failed=sql(migration.replace(/COMMIT;\s*$/, "DO $$ BEGIN RAISE EXCEPTION 'injected_swing100_ddl_failure'; END $$; COMMIT;"),false);
assert.match(failed.stderr,/injected_swing100_ddl_failure/);
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL`).stdout.trim(),'t');
assert.equal(sql(`SELECT pg_get_functiondef('${writer}'::regprocedure)`).stdout,before);
sql(migration);
assert.equal(sql(`SELECT pg_get_functiondef('${writer}'::regprocedure)`).stdout,before);
}
const seed=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8').split('-- Isolated 40-table capacity seam.')[0]
 .replace('BEGIN;',`BEGIN;
 SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
 SET LOCAL request.jwt.claim.role='authenticated';
 SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1800000-0000-4000-8000-000000000001"}',true);`);
assert.ok(seed.includes('worker_assign_dealer_to_session_v1'));
const result=sql(seed+readFileSync('tests/dealerSwing/manualSwingReceipt.pg17.sql','utf8'));
assert.match(result.stdout,/MANUAL_SWING100_REAL_WRITER_RECEIPT_ACTOR_PAYLOAD_READONLY_PASS/);
console.log(process.argv.includes('--runtime-only')?'MANUAL_SWING100_REAL_WRITER_READER_PASS':'MANUAL_SWING100_DDL_ROLLBACK_AND_REAL_WRITER_READER_PASS');
