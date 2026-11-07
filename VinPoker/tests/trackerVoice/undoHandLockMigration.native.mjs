import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql} from '../publicHud/nativeDb.mjs';
import {scanMigrationSource} from '../../scripts/ops/ops-1359-release-gate.mjs';

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
console.log(JSON.stringify({kind:'CORRECTION_HAND_LOCK_MIGRATION_NATIVE_GUARDS',passed:true,checks:8,oldBody,newBody,allExperimentsRolledBack:true,productionChanged:false,qualification:false}));
