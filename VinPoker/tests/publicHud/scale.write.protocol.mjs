import assert from 'node:assert/strict';
export const matchedWriterProtocol=Object.freeze({version:'canonical-hand-observers-paired-v1',pairs:3,orders:['AB','BA','AB'],warmupPerArm:20,gradedPerArm:200,p95:'nearest-rank pooled raw samples; no averaging p95',limitPercent:10,scope:'fixture completed-hand writer only; not settlement/result/withdrawal or Floor auth E2E'});
// Consumers supply their own current-run identity; a report cannot certify itself.
// This validates diagnostic evidence only. Qualification remains a separate gate.
export function validateMatchedWriterEvidence(report,expectedIdentity){
 assert.ok(expectedIdentity&&Object.keys(expectedIdentity).length,'Expected run identity required');
 assert.deepEqual(report.identity,expectedIdentity,'Writer evidence belongs to another source/run/fixture');
 assert.match(expectedIdentity.sha,/^[a-f0-9]{40}$/);
 assert.match(expectedIdentity.runId,/^[1-9][0-9]*$/);
 assert.match(expectedIdentity.runAttempt,/^[1-9][0-9]*$/);
 assert.match(expectedIdentity.manifestSha256,/^[a-f0-9]{64}$/);
 assert.match(expectedIdentity.fixtureInputsSha256,/^[a-f0-9]{64}$/);
 assert.match(expectedIdentity.sourceFunctionsSha256,/^[a-f0-9]{64}$/);
 assert.match(expectedIdentity.database,/^vinpoker_hud_test_pair_[0-9]+_[0-9]+$/);
 assert.equal(expectedIdentity.database,`vinpoker_hud_test_pair_${expectedIdentity.runId}_${expectedIdentity.runAttempt}`);
 assert.ok(Number.isSafeInteger(expectedIdentity.sourceHands)&&expectedIdentity.sourceHands>0);
 assert.equal(report.sourceHands,expectedIdentity.sourceHands);
 assert.equal(report.database,expectedIdentity.database);
 assert.equal(report.sourceTriggerCatalogRestored,true);
 assert.equal(report.observerFunctionMetadataRestored,true);
 assert.equal(report.sourceFunctionsRestored,true);
 return matchedWriterStatistics(report.pairs);
}
export function matchedWriterStatistics(pairs){
 assert.equal(pairs.length,3,'Three predefined pairs required');
 const pooled={withoutHudMarker:[],incremental:[]};let configuration;
 const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
 const measured=pairs.map((pair,index)=>{
  assert.equal(pair.pair,index+1);
  assert.deepEqual(pair.order,index%2?['incremental','withoutHudMarker']:['withoutHudMarker','incremental']);
  const values={};
  for(const arm of pair.order){
   const measurement=pair.measurements[arm],records=measurement.orderedTransactions;
   assert.equal(records.length,220,'All warmup and graded transactions required');
   const config=measurement.configuration;
   assert.equal(config.fsync,'on');assert.equal(config.fullPageWrites,'on');assert.equal(config.synchronousCommit,'on');
   assert.equal(config.commit,true);assert.equal(config.pgbenchProtocol,'prepared');assert.equal(config.clients,1);assert.equal(config.threads,1);
   configuration??=config;assert.deepEqual(config,configuration,'Matched durability and connection configuration required');
   for(let i=0;i<records.length;i++){
    const row=records[i];assert.equal(row.warmup,i<20);assert.equal(row.client,0);assert.equal(row.script,0);
    assert.ok(Number.isFinite(row.latencyMs)&&row.latencyMs>=0);
    assert.ok(Number.isInteger(row.epochSeconds)&&row.epochSeconds>0&&Number.isInteger(row.epochMicros)&&row.epochMicros>=0&&row.epochMicros<1000000);
    assert.ok(Number.isInteger(row.transaction)&&(!i||row.transaction===records[i-1].transaction+1));
   }
   values[arm]=records.filter(row=>!row.warmup).map(row=>row.latencyMs);
   pooled[arm].push(...values[arm]);
  }
  const baselineP95Ms=p95(values.withoutHudMarker),candidateP95Ms=p95(values.incremental);
  assert.ok(baselineP95Ms>0);
  return {pair:index+1,baselineP95Ms,candidateP95Ms,overheadPercent:(candidateP95Ms/baselineP95Ms-1)*100};
 });
 const baselineP95Ms=p95(pooled.withoutHudMarker),candidateP95Ms=p95(pooled.incremental);
 assert.ok(baselineP95Ms>0);
 const overheadPercent=(candidateP95Ms/baselineP95Ms-1)*100;
 return {protocol:matchedWriterProtocol,configuration,gradedPerArm:600,pairs:measured,baselineP95Ms,candidateP95Ms,overheadPercent,passed:overheadPercent<=10&&measured.every(pair=>pair.overheadPercent<=10)};
}
