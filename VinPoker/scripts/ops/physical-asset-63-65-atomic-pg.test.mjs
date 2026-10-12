import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { atomicSql,postcheckSql,executePackage } from './physical-asset-63-65-release-plan.mjs';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.match(process.env.PGDATABASE??'',/^vinpoker_ops_asset63_atomic_/);
function result(input) {
  return spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:15000});
}
function sql(input) {
  const r=result(input);assert.equal(r.status,0,r.stderr||String(r.error));return r.stdout.trim();
}
const json=input=>JSON.parse(sql(input).split('\n').find(line=>line.startsWith('{')));
assert.equal(sql("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
assert.equal(sql("SELECT to_regprocedure('public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)') IS NULL AND (SELECT count(*) FROM public.clubs)=0 AND (SELECT count(*) FROM public.game_tables)=0;"),'t');
// Local schema-only capture excludes the Supabase managed ledger. Test its
// exact package columns without inventing any live receipt or operational row.
sql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
 CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'0');
const combined=atomicSql();
// Fail the second receipt: the first ledger INSERT must roll back too.
const anchor='INSERT INTO supabase_migrations.schema_migrations(version,name,statements)';
const second=combined.lastIndexOf(anchor);
assert.ok(second>combined.indexOf(anchor));
const injected=combined.slice(0,second)+"DO $asset_fault$ BEGIN RAISE EXCEPTION 'injected_asset_ledger_failure'; END $asset_fault$;\n"+combined.slice(second);
const failed=result(injected);
assert.notEqual(failed.status,0);assert.match(failed.stderr,/injected_asset_ledger_failure/);
assert.equal(sql("SELECT to_regprocedure('public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)') IS NULL AND (SELECT count(*) FROM supabase_migrations.schema_migrations)=0;"),'t');
console.log('ASSET63_65_DDL_LEDGER_FAILURE_ATOMIC_ROLLBACK_PASS');
let attempts=0;const reports=[];
// Real COMMIT, discarded response; a separate connection must prove exact state.
assert.throws(()=>executePackage({execute(input){attempts++;sql(input);throw Error('response discarded after commit');},json},x=>reports.push(x)),/requires review/);
assert.equal(attempts,1);assert.match(reports[0],/committed-exact; no retry/);
assert.deepEqual(json(postcheckSql()),{receipts:true,object:true});
assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'2');
console.log('ASSET63_65_COMMIT_RESPONSE_LOSS_EXACT_RECOVERY_PASS');
const repeated=result(combined);
assert.notEqual(repeated.status,0);assert.match(repeated.stderr,/asset_package_existing_receipt_stop/);
assert.deepEqual(json(postcheckSql()),{receipts:true,object:true});
sql("ALTER FUNCTION public.declare_club_physical_table_v1(uuid,integer,uuid,uuid) SET search_path=public;");
assert.deepEqual(json(postcheckSql()),{receipts:true,object:false});
console.log('ASSET63_65_REPEAT_AND_OBJECT_DRIFT_FAIL_CLOSED_PASS');
