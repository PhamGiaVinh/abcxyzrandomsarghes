import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {postcheckSql,classifyPostcheck} from './spectator342344-protected-apply.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
import {pauseSql,resumeSql,activeSql,drainSql} from './spectator342344-dispatch-control.mjs';

// TEST ONLY, no hosted connection, copied users, money transactions or dispatch.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'5432');
assert.equal(process.env.PGUSER,'postgres');
assert.match(process.env.PUBLIC_HUD_LOCAL_DATABASE??'',/^vinpoker_hud_test_release_[a-z0-9_]+$/);
assert.ok(!['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'].some(key=>process.env[key]));
const root=resolve(process.env.RELEASE_SOURCE_ROOT),pkg=loadPackage(root);
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),pkg.manifest.referenceProductSha);
process.chdir(root);
const {initialize,sql,jsonSql,sqlAsync,service}=await import(pathToFileURL(resolve(root,'tests/publicHud/nativeDb.mjs')));
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
// Match the explicit live owner/ACL preimage, as in the qualified generation
// fixture. Do not weaken the migration guard to accommodate a test bootstrap.
sql(`REVOKE ALL ON FUNCTION spectator_projection_v2.mark_dirty(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION spectator_projection_v2.mark_dirty(uuid,text,text,text) TO service_role;`);
assert.equal(sql("SELECT md5(pg_get_functiondef('spectator_projection_v2.mark_dirty(uuid,text,text,text)'::regprocedure));"),'e5684f8818e0d536bcdde7842032f71d');
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
 assert.throws(()=>sql(entry.atomic,{captureFailure:true}),error=>error.stderr?.includes('isolated receipt rejection'),'Injected receipt trigger must actually be reached');
 assert.deepEqual(snapshot(),before,'DDL/function/ledger state rolls back together');
 sql('DROP TRIGGER reject_receipt ON supabase_migrations.schema_migrations;');
 sql(entry.atomic);
 const item={...entry,hash:entry.sha256};
 assert.deepEqual(jsonSql(receiptSql(item)),{count:1,exact:true});
 classifyPostcheck(jsonSql(postcheckSql(pkg,Number(entry.version.slice(-3)))));
 const after=snapshot();
 assert.throws(()=>sql(entry.atomic,{captureFailure:true}),error=>error.stderr?.includes('migration ledger conflict'),'Duplicate version must hit ledger conflict');
 assert.deepEqual(snapshot(),after);
}
sql('GRANT EXECUTE ON FUNCTION public.get_public_spectator_projection_sources_v2(jsonb) TO anon;');
assert.throws(()=>classifyPostcheck(jsonSql(postcheckSql(pkg,344))),'Exposed privileged function must fail postcheck');
sql('REVOKE EXECUTE ON FUNCTION public.get_public_spectator_projection_sources_v2(jsonb) FROM anon;');
classifyPostcheck(jsonSql(postcheckSql(pkg,344)));
for(const table of ['source_nonblocking_original_v1','source_pending_original_v1']){
 sql(`GRANT INSERT ON spectator_projection_v2.${table} TO anon;`);
 assert.throws(()=>classifyPostcheck(jsonSql(postcheckSql(pkg,344))),'Write privilege must fail private recovery check');
 sql(`REVOKE INSERT ON spectator_projection_v2.${table} FROM anon;`);
 const definition=sql(`SELECT encode(convert_to(definition,'UTF8'),'hex') FROM spectator_projection_v2.${table};`);
 assert.match(definition,/^[a-f0-9]+$/);
 sql(`UPDATE spectator_projection_v2.${table} SET definition=definition||E'\\n-- corrupted';`);
 assert.throws(()=>classifyPostcheck(jsonSql(postcheckSql(pkg,344))),'Corrupted recovery definition must fail');
 // Hex preserves trailing newlines across the psql test transport's trim().
 sql(`UPDATE spectator_projection_v2.${table} SET definition=convert_from(decode('${definition}','hex'),'UTF8');`);
 classifyPostcheck(jsonSql(postcheckSql(pkg,344)));
}
console.log('SPECTATOR342344_NATIVE_ATOMIC_ROLLBACK_RECEIPTS_REPLAY_ACL_PASS');
// The scheduler API below is a recording double. PostgreSQL executes the real
// guard/row-version/transaction SQL; this is NOT pg_cron or HTTP delivery proof.
// Current production definition captured read-only2026-11-15; no secret literal.
// Historical pending source differs, so it must not masquerade as this preimage.
sql(readFileSync(new URL('./spectator342344-dispatcher-current.fixture.sql',import.meta.url),'utf8'));
assert.equal(sql("SELECT md5(pg_get_functiondef('public.dispatch_public_spectator_projection_v2()'::regprocedure));"),'cf705ee6551a85a61724228ede8f7945');
sql(`CREATE SCHEMA cron;CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,database text,username text,command text,active boolean);
 INSERT INTO cron.job VALUES(52,'public-spectator-v2-dispatch','1 second','postgres','postgres','SELECT public.dispatch_public_spectator_projection_v2()',true),
 (55,'public-hud-projection-v1-dispatch','1 second','postgres','postgres','SELECT public.dispatch_public_hud_projection_v1()',true);
 CREATE FUNCTION cron.alter_job(job_id bigint,active boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET active=$2 WHERE jobid=$1$$;
 CREATE SCHEMA net;CREATE TABLE net.http_request_queue(url text);`);
assert.equal(jsonSql(activeSql()).exact,true);
const paused=jsonSql(pauseSql());assert.equal(paused.paused,true);assert.match(paused.pauseXmin,/^\d+$/);
assert.equal(sql('SELECT active FROM cron.job WHERE jobid=55;'),'t');
assert.throws(()=>sql(resumeSql('1'),{captureFailure:true}),error=>error.stderr?.includes('dispatcher_pause_ownership_drift'));
assert.equal(jsonSql(resumeSql(paused.pauseXmin)).resumed,true);
const owned=jsonSql(pauseSql());
sql("UPDATE cron.job SET schedule='1 second' WHERE jobid=52;");
assert.throws(()=>sql(resumeSql(owned.pauseXmin),{captureFailure:true}),error=>error.stderr?.includes('dispatcher_pause_ownership_drift'));
assert.equal(sql('SELECT active FROM cron.job WHERE jobid=52;'),'f');
assert.deepEqual(jsonSql(drainSql()),{leaseCount:0,queuedRequests:0,activeCalls:0});
sql("INSERT INTO net.http_request_queue(url) VALUES('https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/public-spectator-projector-v2');");
assert.equal(jsonSql(drainSql()).queuedRequests,1);
sql('DELETE FROM net.http_request_queue;');
for(const rpc of ['absorb_public_spectator_generations_v2','flush_public_spectator_broadcast_v2']){
 const running=sqlAsync(`${service}SELECT public.${rpc}((SELECT 100 FROM pg_sleep(2)));`);
 let observed=false;
 for(let i=0;i<30;i++){
  if(jsonSql(drainSql()).activeCalls>0){observed=true;break;}
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.ok(observed,'Startup RPC must prevent a quiet-drain observation');await running;
}
console.log('SPECTATOR342344_NATIVE_DISPATCH_GUARDS_WITH_SCHEDULER_DOUBLE_PASS');
