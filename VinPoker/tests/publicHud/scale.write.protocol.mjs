import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const sourceGeneration342Profile=Object.freeze({migration:'20270128000342_nonblocking_spectator_source_generation.sql',sqlSha256:'329598b30c0dd07b3832c2309fc7b61b668352926b7c25d35c97db35d8c57c83',bodyMd5:'c1da47ebdf9a70ac414ae3f2ccc4b8c0',definitionMd5:'0d471115d7d14e8f780859f83cd2598c'});
export function validateCanonicalWriterObservers(profile,{sourceGenerationProbe=false}={}){
 assert.equal(typeof sourceGenerationProbe,'boolean');
 const names=['mark_dirty','mark_hand_child_dirty','mark_row_dirty'];
 const expected={baseline:['5275ae9972ac43651bd1b831b52332dd','e9df156b6ee5d6a22ba968257ae38852','34ebfad5c2bea4d3306d67d435fe02a6'],candidate:['e5684f8818e0d536bcdde7842032f71d','c9f805174bf0cf551aff43a748684df1','27a7e7aad6c0a9f52b040594b4ac115b']};
 if(sourceGenerationProbe)expected.candidate[0]=sourceGeneration342Profile.definitionMd5;
 for(const arm of ['baseline','candidate']){
  assert.deepEqual(profile?.[arm]?.map(row=>row.name),names,'Canonical observer set required');
  for(let i=0;i<names.length;i++)assert.equal(createHash('md5').update(profile[arm][i].definition).digest('hex'),expected[arm][i],`Canonical ${arm} observer required`);
 }
}
// Explicit opt-in only: historical diagnostic runs never become qualification.
export function requireMatchedWriterQualification(report,expectedIdentity,{sourceGenerationProbe=false}={}){
 assert.equal(report?.sourceGenerationCandidate??null,sourceGenerationProbe?sourceGeneration342Profile.migration:null,'Explicit source generation profile must match');
 validateCanonicalWriterObservers(report?.observerProfile,{sourceGenerationProbe});
 const statistics=validateMatchedWriterEvidence(report,expectedIdentity);
 assert.equal(statistics.passed,true,'Matched writer pooled or predefined pair overhead > 10%');
 return {method:matchedWriterProtocol.version,identity:expectedIdentity,statistics,scope:matchedWriterProtocol.scope,...(sourceGenerationProbe?{sourceGenerationCandidate:sourceGeneration342Profile}:{})};
}
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
