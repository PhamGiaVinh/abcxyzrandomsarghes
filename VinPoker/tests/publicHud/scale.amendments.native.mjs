import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {sql,jsonSql,service} from './nativeDb.mjs';
import {nativeWorkerClient} from './nativeRpc.mjs';
import {parseFixtureHudBarrier} from './scale.failures.mjs';

const temp=mkdtempSync(join(tmpdir(),'hud-amendment-worker-'));
await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],outfile:join(temp,'worker.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {processPublicHudJobs}=await import(pathToFileURL(join(temp,'worker.mjs')));
const drain=async()=>{
 for(let n=0;n<40&&Number(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'))>0;n++){
  const result=await processPublicHudJobs(nativeWorkerClient,80,Date.now()+20000);
  assert.equal(result.failed,0,JSON.stringify(result));
 }
 assert.equal(sql('SELECT count(*) FROM tracker_analytics_v1.jobs;'),'0');
};
sql(readFileSync('tests/publicHud/scale.amendments.fixture.sql','utf8'));
await drain();
const hand='20000000-0000-4000-8000-000000000001';
const kinds=['correct','void','restore','verify','revoke','reverify','result_create','result_edit','result_revoke','result_reverify'];
const samples=[],barrierObservations=[];
const readiness=operation=>{
 const probe=jsonSql(`${service}WITH checked AS MATERIALIZED (
  SELECT public.fixture_scale_amend_ready_v1('${operation}') AS ready)
  SELECT jsonb_build_object('ready',ready,'headers',current_setting('response.headers')::jsonb,'after',clock_timestamp()) FROM checked;`);
 const observedAt=Date.parse(probe.headers[0]['X-Hud-Fixture-Observed-At']);
 assert.ok(Number.isFinite(observedAt)&&observedAt<=Date.parse(probe.after),'Readiness clock must follow its snapshot');
 const headers=Object.fromEntries(Object.entries(probe.headers[0]).map(([key,value])=>[key.toLowerCase(),value]));
 const barrier=parseFixtureHudBarrier(headers);assert.ok(barrier,'Missing bounded barrier observation');
 assert.ok(observedAt<=barrier.from&&barrier.until<=Date.parse(probe.after),'Separate barrier snapshot must follow readiness and precede response');
 barrierObservations.push({ready:probe.ready,...barrier});
 return probe.ready;
};
let revision;
for(const kind of kinds){
 const operation=randomUUID();
 const request=`${service}SELECT public.fixture_scale_amend_once_v1('${operation}','${hand}','${kind}');`;
 const value=jsonSql(request),again=jsonSql(request);
 assert.deepEqual(again,value,'Committed mutation retries must return the original receipt');
 assert.equal(readiness(operation),false,'Old contributions must not satisfy the new receipt');
 if(['revoke','reverify'].includes(kind))assert.equal(value.sourceRevision,revision,'Settlement invalidates without changing hand revision');
 revision=value.sourceRevision;
 await drain();
 assert.equal(readiness(operation),true);
 assert.equal(barrierObservations.at(-1).blocked,false,'Drained fixture must have no remaining HUD barrier');
 samples.push({kind,operation,sourceRevision:value.sourceRevision,ready:true});
}
assert.ok(barrierObservations.some(value=>value.blocked),'Withdrawal fixture must exercise an actual HUD barrier');
for(const role of ['anon','authenticated']){
 assert.throws(()=>sql(`SET ROLE ${role};SELECT public.fixture_scale_amend_once_v1('${randomUUID()}','${hand}','correct');`),/permission denied/);
 assert.throws(()=>sql(`SET ROLE ${role};SELECT public.fixture_scale_amend_ready_v1('${samples[0].operation}');`),/permission denied/);
 assert.throws(()=>sql(`SET ROLE ${role};SELECT public.fixture_scale_hud_preparation_state_v1('10000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000001',clock_timestamp());`,{captureFailure:true}),/permission denied/);
}
const diagnosticCall="public.fixture_scale_hud_preparation_state_v1('10000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000001',clock_timestamp())";
assert.throws(()=>sql(`${service}SELECT public.fixture_scale_hud_preparation_state_v1('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',clock_timestamp());`,{captureFailure:true}),/fixture_diagnostic_scope/);
const diagnostic=jsonSql(`${service}SELECT ${diagnosticCall};`);assert.ok(Array.isArray(diagnostic.jobs));assert.ok(Array.isArray(diagnostic.hardBlocks));assert.equal(typeof diagnostic.hiddenPolicyHands,'number');
const diagnosticPlan=jsonSql(`${service}EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT ${diagnosticCall};`)[0];
const diagnosticCost={scope:'Single pre-load real-function query on the seeded database;not under audience load. Runtime HTTP/statements timings are recorded separately.',executionMs:diagnosticPlan['Execution Time'],planningMs:diagnosticPlan['Planning Time'],sharedHits:diagnosticPlan.Plan['Shared Hit Blocks'],sharedReads:diagnosticPlan.Plan['Shared Read Blocks'],planRows:diagnosticPlan.Plan['Plan Rows'],actualRows:diagnosticPlan.Plan['Actual Rows']};
assert.throws(()=>sql(`${service}SELECT public.fixture_scale_amend_once_v1('${samples[0].operation}','${hand}','void');`),/fixture_operation_conflict/);
assert.throws(()=>sql(`${service}SELECT public.fixture_scale_amend_once_v1('${randomUUID()}','${hand}','unknown');`),/invalid_amendment/);
// An old receipt cannot be made ready just because a newer job finished.
assert.equal(sql(`${service}SELECT public.fixture_scale_amend_ready_v1('${samples[0].operation}');`),'f');
const report={kind:'NATIVE_REAL_PROJECTOR_AMENDMENT_RECEIPTS_NOT_LOAD_LATENCY',passed:true,samples,diagnosticCost,checks:['exact-source-fingerprint','old-contribution-rejected','source-revision-unchanged-settlement','void-subtracted','restore-readded','result-edit-revoke-reverify','idempotent-committed-retry','scope-conflict','browser-denial','superseded-receipt-denied','service-only-preparation-diagnostic','preload-diagnostic-plan','readiness-clock-after-snapshot']};
if(process.env.PUBLIC_HUD_AMENDMENT_NATIVE_REPORT)writeFileSync(process.env.PUBLIC_HUD_AMENDMENT_NATIVE_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
