import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {postcheckSql,classifyPostcheck} from './spectator342344-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';

// TEST ONLY, no hosted connection, copied users, money transactions or dispatch.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'5432');
assert.equal(process.env.PGUSER,'postgres');
assert.match(process.env.PUBLIC_HUD_LOCAL_DATABASE??'',/^vinpoker_hud_test_release_[a-z0-9_]+$/);
assert.ok(!['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'].some(key=>process.env[key]));
const root=resolve(process.env.RELEASE_SOURCE_ROOT),pkg=loadPackage(root);
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),pkg.manifest.referenceProductSha);
process.chdir(root);
const {initialize,sql,jsonSql}=await import(pathToFileURL(resolve(root,'tests/publicHud/nativeDb.mjs')));
sql('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
initialize();
for(const file of ['tests/publicHud/spectator-generation.fixture.sql','tests/publicHud/scale-runtime.fixture.sql',
 'supabase/migrations/20261104001900_public_spectator_compact_generations.sql',
 'supabase/migrations/20261104002100_public_current_hand_bounded.sql'])sql(readFileSync(file,'utf8'));
const original=readFileSync('supabase/pending-migrations/20270115000000_public_spectator_realtime_v2.sql','utf8');
for(const [begin,end] of [['CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2'],
 ['CREATE OR REPLACE FUNCTION public.fail_public_spectator_projection_v2','CREATE OR REPLACE FUNCTION public.get_public_tournament_viewer_snapshot_v2']]){
 assert.ok(original.indexOf(begin)>=0&&original.indexOf(end)>original.indexOf(begin));
 sql(original.slice(original.indexOf(begin),original.indexOf(end)));
}
sql(readFileSync('supabase/migrations/20261106144208_public_spectator_source_lease_outcome.sql','utf8'));
sql(`CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
 CREATE FUNCTION supabase_migrations.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'isolated receipt rejection';END$$;`);
const snapshot=()=>jsonSql(`SELECT json_build_object(
 'marker',md5(pg_get_functiondef('spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure)),
 'source',md5(pg_get_functiondef('public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure)),
 'batch',to_regprocedure('public.get_public_spectator_projection_sources_v2(jsonb)') IS NOT NULL,
 'original342',to_regclass('spectator_projection_v2.source_nonblocking_original_v1') IS NOT NULL,
 'original343',to_regclass('spectator_projection_v2.source_pending_original_v1') IS NOT NULL,
 'receipts',(SELECT count(*) FROM supabase_migrations.schema_migrations));`);
for(const entry of pkg.entries){
 const before=snapshot();
 sql('CREATE TRIGGER reject_receipt BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION supabase_migrations.reject_receipt();');
 assert.throws(()=>sql(entry.atomic,{captureFailure:true}),'Injected receipt failure must abort DDL');
 assert.deepEqual(snapshot(),before,'DDL/function/ledger state rolls back together');
 sql('DROP TRIGGER reject_receipt ON supabase_migrations.schema_migrations;');
 sql(entry.atomic);
 const item={...entry,hash:entry.sha256};
 assert.deepEqual(jsonSql(receiptSql(item)),{count:1,exact:true});
 classifyPostcheck(jsonSql(postcheckSql(pkg,Number(entry.version.slice(-3)))));
 const after=snapshot();
 assert.throws(()=>sql(entry.atomic,{captureFailure:true}),'Duplicate version must not replay');
 assert.deepEqual(snapshot(),after);
}
sql('GRANT EXECUTE ON FUNCTION public.get_public_spectator_projection_sources_v2(jsonb) TO anon;');
assert.throws(()=>classifyPostcheck(jsonSql(postcheckSql(pkg,344))),'Exposed privileged function must fail postcheck');
sql('REVOKE EXECUTE ON FUNCTION public.get_public_spectator_projection_sources_v2(jsonb) FROM anon;');
classifyPostcheck(jsonSql(postcheckSql(pkg,344)));
console.log('SPECTATOR342344_NATIVE_ATOMIC_ROLLBACK_RECEIPTS_REPLAY_ACL_PASS');
