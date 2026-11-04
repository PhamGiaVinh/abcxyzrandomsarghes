import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {sql,jsonSql,service} from './nativeDb.mjs';
import {nativeWorkerClient} from './nativeRpc.mjs';

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
const samples=[];
let revision;
for(const kind of kinds){
 const operation=randomUUID();
 const request=`${service}SELECT public.fixture_scale_amend_once_v1('${operation}','${hand}','${kind}');`;
 const value=jsonSql(request),again=jsonSql(request);
 assert.deepEqual(again,value,'Committed mutation retries must return the original receipt');
 assert.equal(sql(`${service}SELECT public.fixture_scale_amend_ready_v1('${operation}');`),'f','Old contributions must not satisfy the new receipt');
 if(['revoke','reverify'].includes(kind))assert.equal(value.sourceRevision,revision,'Settlement invalidates without changing hand revision');
 revision=value.sourceRevision;
 await drain();
 assert.equal(sql(`${service}SELECT public.fixture_scale_amend_ready_v1('${operation}');`),'t');
 samples.push({kind,operation,sourceRevision:value.sourceRevision,ready:true});
}
for(const role of ['anon','authenticated']){
 assert.throws(()=>sql(`SET ROLE ${role};SELECT public.fixture_scale_amend_once_v1('${randomUUID()}','${hand}','correct');`),/permission denied/);
 assert.throws(()=>sql(`SET ROLE ${role};SELECT public.fixture_scale_amend_ready_v1('${samples[0].operation}');`),/permission denied/);
}
assert.throws(()=>sql(`${service}SELECT public.fixture_scale_amend_once_v1('${samples[0].operation}','${hand}','void');`),/fixture_operation_conflict/);
assert.throws(()=>sql(`${service}SELECT public.fixture_scale_amend_once_v1('${randomUUID()}','${hand}','unknown');`),/invalid_amendment/);
// An old receipt cannot be made ready just because a newer job finished.
assert.equal(sql(`${service}SELECT public.fixture_scale_amend_ready_v1('${samples[0].operation}');`),'f');
const report={kind:'NATIVE_REAL_PROJECTOR_AMENDMENT_RECEIPTS_NOT_LOAD_LATENCY',passed:true,samples,checks:['exact-source-fingerprint','old-contribution-rejected','source-revision-unchanged-settlement','void-subtracted','restore-readded','result-edit-revoke-reverify','idempotent-committed-retry','scope-conflict','browser-denial','superseded-receipt-denied']};
if(process.env.PUBLIC_HUD_AMENDMENT_NATIVE_REPORT)writeFileSync(process.env.PUBLIC_HUD_AMENDMENT_NATIVE_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
