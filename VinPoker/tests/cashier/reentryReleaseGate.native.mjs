import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql} from '../publicHud/nativeDb.mjs';
import {loadReentryPackage,atomicQuery,reentryStateSql,validateReentryState,reentryPostcheckSql,validateReentryPostcheck} from '../../scripts/ops/tracker-hud-20261104-release.mjs';

// Existing disposable current-schema clone; each synthetic ledger experiment
// rolls back. This proves the gate, not hosted Auth or payment performance.
assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_reentry_transport_20261107a');
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_hud_test_reentry_transport_20261107a|127.0.0.1|55441');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
const supplement=loadReentryPackage();
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const inner=s=>s.trim().replace(/^BEGIN;/,'').replace(/COMMIT;$/,'');
const recovery=readFileSync(new URL('../../scripts/ops/cashier-app-reentry-20261107-rollback.sql',import.meta.url),'utf8');
const drop=inner(recovery.slice(recovery.indexOf('BEGIN;')));
const baselineFingerprint=sql("SELECT md5('baseline:baseline:'||md5('SELECT 1;')); ");
const pkg={...supplement.base,manifest:{...supplement.base.manifest,baselineLedgerRows:1,baselineLedgerFingerprint:baselineFingerprint}};
const fixture=`BEGIN;${drop}
 CREATE SCHEMA IF NOT EXISTS cron;
 CREATE TABLE IF NOT EXISTS cron.job(jobname text,active boolean);
 TRUNCATE supabase_migrations.schema_migrations;
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('baseline','baseline',ARRAY['SELECT 1;']);
 ${pkg.entries.map(e=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${literal(e.version)},${literal(e.name)},ARRAY[${literal(e.sql)}]);`).join('\n')}`;
const before=sql("SELECT md5(pg_get_functiondef('public.cashier_app_reentry_transport_v1(uuid,uuid)'::regprocedure))||'|'||(SELECT count(*) FROM supabase_migrations.schema_migrations);");
validateReentryState(JSON.parse(sql(fixture+reentryStateSql(pkg)+'ROLLBACK;',{captureFailure:true})),pkg);
const apply=inner(atomicQuery(supplement.entry,pkg));
const check=JSON.parse(sql(fixture+apply+reentryPostcheckSql()+'ROLLBACK;',{captureFailure:true}));
validateReentryPostcheck(check,supplement.manifest);
const rejects=(mutation,marker)=>assert.throws(()=>sql(fixture+mutation+apply+'ROLLBACK;',{captureFailure:true}),e=>String(e.stderr??'').includes(marker));
rejects(`UPDATE supabase_migrations.schema_migrations SET statements=array_append(statements,'SELECT 2;') WHERE version='${pkg.entries[0].version}';`,'HUD release prior receipt differs');
rejects(`DELETE FROM supabase_migrations.schema_migrations WHERE version='${pkg.entries[0].version}';`,'HUD release baseline or paused dispatcher changed');
rejects("UPDATE supabase_migrations.schema_migrations SET name='drift' WHERE version='baseline';",'HUD release baseline or paused dispatcher changed');
rejects("INSERT INTO cron.job VALUES('public-spectator-v2-dispatch',true);",'HUD release baseline or paused dispatcher changed');
rejects(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261107013500','cashier_app_reentry_transport_v1',ARRAY['SELECT 1;']);`,'migration ledger conflict');
assert.equal(sql("SELECT md5(pg_get_functiondef('public.cashier_app_reentry_transport_v1(uuid,uuid)'::regprocedure))||'|'||(SELECT count(*) FROM supabase_migrations.schema_migrations);"),before);
console.log(JSON.stringify({kind:'REENTRY_SUPPLEMENT_RELEASE_GATE_NATIVE',passed:true,checks:8,syntheticLedger:true,allExperimentsRolledBack:true,productionApplied:false}));
