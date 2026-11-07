import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,sqlAsync} from '../publicHud/nativeDb.mjs';
import {scanMigrationSource} from '../../scripts/ops/ops-1359-release-gate.mjs';
import {loadCorrectionPackage,correctionStateSql,validateCorrectionState,atomicQuery,reentryPostcheckSql,validateReentryPostcheck} from '../../scripts/ops/tracker-hud-20261104-release.mjs';

assert.equal(process.env.PUBLIC_HUD_LOCAL_DATABASE,'vinpoker_hud_test_current_undo_20261107a');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'vinpoker-owned-current-undo-20261107a');
assert.equal(sql("SELECT host(inet_server_addr())||':'||inet_server_port();"),'127.0.0.1:55441');
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('\r','');
const inner=text=>{const frame=scanMigrationSource(text);assert.equal(frame.mode,'outer-transaction');return text.slice(frame.insertAfterBegin,frame.insertBeforeCommit);};
const apply=inner(read('../../supabase/migrations/20261107045330_tracker_correction_hand_lock_order_v1.sql'));
const recovery=inner(read('../../scripts/ops/tracker-correction-hand-lock-20261107-rollback.sql'));
const signature='public._tracker_correction_uat_context(uuid,uuid,uuid,text)';
const fingerprint=`SELECT md5(pg_get_functiondef('${signature}'::regprocedure))||'|'||(SELECT proacl::text FROM pg_proc WHERE oid='${signature}'::regprocedure);`;
const before=sql(fingerprint);
const oldBody='2e3c0d73bce278f80a8983d3a425f206',newBody='6fbc46ed8c9b7712a4546480a07385ae';
const body=`SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='${signature}'::regprocedure;`;
assert.equal(sql(body),oldBody);
assert.equal(sql('BEGIN;'+apply+body+'ROLLBACK;',{captureFailure:true}),newBody);
const rejects=(query,marker)=>{
 let rejected=false;
 try{sql('BEGIN;'+query+'ROLLBACK;',{captureFailure:true});}catch(e){rejected=String(e.stderr??'').includes(marker);}
 assert.equal(rejected,true,'exact migration guard must reject '+marker);
 assert.equal(sql(fingerprint),before,'failed transaction must preserve original definition and ACL');
};
rejects(apply+apply,'tracker_correction_context_preimage_drift');
rejects(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`+apply,'tracker_correction_context_preimage_drift');
rejects(`ALTER FUNCTION ${signature} SECURITY INVOKER;`+apply,'tracker_correction_context_preimage_drift');
rejects(recovery,'tracker_correction_context_recovery_drift');
rejects(apply+`ALTER FUNCTION ${signature} STABLE;`+recovery,'tracker_correction_context_recovery_drift');
assert.equal(sql('BEGIN;'+apply+recovery+fingerprint+'ROLLBACK;',{captureFailure:true}),before);
assert.equal(sql(fingerprint),before);
// Synthetic32-receipt prefix on this same owned schema. All ledger changes and
// the actual33 migration are rolled back; this is not a31-migration replay.
const supplement=loadCorrectionPackage();
const ledgerBefore=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY version)::text,'')) FROM supabase_migrations.schema_migrations t;");
const ledgerFingerprint=sql("SELECT md5('native-baseline:baseline:'||md5('SELECT 1;')); ");
const pkg={...supplement.base,manifest:{...supplement.base.manifest,baselineLedgerRows:1,baselineLedgerFingerprint:ledgerFingerprint}};
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const fixture=`BEGIN;CREATE SCHEMA IF NOT EXISTS cron;CREATE TABLE IF NOT EXISTS cron.job(jobname text,active boolean);
 TRUNCATE supabase_migrations.schema_migrations;
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('native-baseline','baseline',ARRAY['SELECT 1;']);
 ${pkg.entries.map(e=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${literal(e.version)},${literal(e.name)},ARRAY[${literal(e.sql)}]);`).join('\n')}`;
validateCorrectionState(JSON.parse(sql(fixture+correctionStateSql(pkg)+'ROLLBACK;',{captureFailure:true})),pkg,supplement.manifest);
const atomic=inner(atomicQuery(supplement.entry,pkg));
const postcheck=reentryPostcheckSql(signature).trim().replace(/;$/,'');
const success=JSON.parse(sql(fixture+atomic+`SELECT json_build_object('object',(${postcheck})::json,'receipt',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${supplement.entry.version}' AND name='${supplement.entry.name}' AND cardinality(statements)=1 AND encode(extensions.digest(convert_to(statements[1],'UTF8'),'sha256'),'hex')='${supplement.entry.sha256}'))::text;ROLLBACK;`,{captureFailure:true}));
validateReentryPostcheck(success.object,supplement.manifest);assert.equal(success.receipt,true);
const gateRejects=(mutation,marker)=>{
 let rejected=false;try{sql(fixture+mutation+atomic+'ROLLBACK;',{captureFailure:true});}catch(e){rejected=String(e.stderr??'').includes(marker);}
 assert.equal(rejected,true,'atomic33 gate must reject '+marker);
 assert.equal(sql(fingerprint),before);assert.equal(sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY version)::text,'')) FROM supabase_migrations.schema_migrations t;"),ledgerBefore);
};
gateRejects("UPDATE supabase_migrations.schema_migrations SET statements=array_append(statements,'SELECT 2;') WHERE version='20261107013500';",'HUD release prior receipt differs');
gateRejects("DELETE FROM supabase_migrations.schema_migrations WHERE version='20261107013500';",'HUD release baseline or paused dispatcher changed');
gateRejects("UPDATE supabase_migrations.schema_migrations SET name='drift' WHERE version='native-baseline';",'HUD release baseline or paused dispatcher changed');
gateRejects("INSERT INTO cron.job VALUES('public-spectator-v2-dispatch',true);",'HUD release baseline or paused dispatcher changed');
gateRejects(`ALTER FUNCTION ${signature} SECURITY INVOKER;`,'tracker_correction_context_preimage_drift');
gateRejects('SET LOCAL track_activities=off;','Correction activity visibility unavailable');
// Temporary read-only ledger grants isolate the statistics-visibility boundary;
// no role memberships, function execution grants or BYPASSRLS are added.
const restricted=JSON.parse(sql(fixture+`GRANT USAGE ON SCHEMA supabase_migrations,cron,extensions TO authenticated;GRANT SELECT ON supabase_migrations.schema_migrations,cron.job TO authenticated;SET LOCAL ROLE authenticated;`+correctionStateSql(pkg)+'ROLLBACK;',{captureFailure:true}));
assert.equal(restricted.activityVisible,false);
assert.throws(()=>validateCorrectionState(restricted,pkg,supplement.manifest),/Correction activity visibility unavailable/);
// Real second PG session tests query-activity rejection only. The marker is
// deliberately synthetic; it is not evidence of hosted RPC visibility.
const probe=sqlAsync('SELECT pg_sleep(3) /* undo_tracker_last_action_v1 native drain marker */;');
try{
 const end=Date.now()+2000;let active=0;
 while(Date.now()<end){active=Number(sql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND datname=current_database() AND state='active' AND query LIKE '%native drain marker%';"));if(active)break;await new Promise(resolve=>setTimeout(resolve,25));}
 assert.equal(active,1);
 gateRejects('','Correction calls have not drained');
}finally{await probe;}
assert.equal(sql(fingerprint),before);
console.log(JSON.stringify({kind:'CORRECTION_HAND_LOCK_MIGRATION_NATIVE_GUARDS',passed:true,migrationChecks:8,releaseGateChecks:10,restrictedRoleVisibilityRejected:true,synthetic32ReceiptPrefix:true,activityMarkerIsSynthetic:true,oldBody,newBody,allExperimentsRolledBack:true,productionChanged:false,qualification:false}));
