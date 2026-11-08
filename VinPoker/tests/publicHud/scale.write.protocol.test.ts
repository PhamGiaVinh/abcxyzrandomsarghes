import {it,expect} from 'vitest';
import {matchedWriterStatistics,validateMatchedWriterEvidence,validateCanonicalWriterObservers} from './scale.write.protocol.mjs';
const fixture=()=>Array.from({length:3},(_,index)=>({pair:index+1,order:index%2?['incremental','withoutHudMarker']:['withoutHudMarker','incremental'],measurements:Object.fromEntries(['incremental','withoutHudMarker'].map(arm=>[arm,{configuration:{fsync:'on',fullPageWrites:'on',synchronousCommit:'on',commit:true,pgbenchProtocol:'prepared',clients:1,threads:1},orderedTransactions:Array.from({length:220},(_,i)=>({client:0,script:0,transaction:i,latencyMs:arm==='incremental'?1.05:1,epochSeconds:1700000000,epochMicros:i,warmup:i<20}))}]))}));
it('rejects missing or noncanonical observer definitions even when names match',()=>{
 expect(()=>validateCanonicalWriterObservers(null)).toThrow();
 const rows=['mark_dirty','mark_hand_child_dirty','mark_row_dirty'].map(name=>({name,definition:'altered implementation'}));
 expect(()=>validateCanonicalWriterObservers({baseline:rows,candidate:rows})).toThrow();
});
it('uses all600 raw graded samples per arm with fixed warmup and pair order',()=>{
 const result=matchedWriterStatistics(fixture());expect(result.gradedPerArm).toBe(600);expect(result.overheadPercent).toBeCloseTo(5);expect(result.passed).toBe(true);
});
const identity=()=>({sha:'a'.repeat(40),runId:'123',runAttempt:'2',database:'vinpoker_hud_test_pair_123_2',sourceHands:1000000,manifestSha256:'b'.repeat(64),fixtureInputsSha256:'c'.repeat(64),sourceFunctionsSha256:'d'.repeat(64)});
const evidence=()=>({identity:identity(),database:identity().database,sourceHands:1000000,sourceTriggerCatalogRestored:true,observerFunctionMetadataRestored:true,sourceFunctionsRestored:true,pairs:fixture()});
it('recomputes diagnostic statistics from raw samples bound to the expected run',()=>{
 const report={...evidence(),passed:true};
 report.pairs[0].measurements.incremental.orderedTransactions.slice(20).forEach(row=>row.latencyMs=2);
 expect(validateMatchedWriterEvidence(report,identity()).passed).toBe(false);
});
it.each(['sha','runId','runAttempt','manifestSha256','fixtureInputsSha256','sourceFunctionsSha256','database','sourceHands'])('rejects mismatched %s identity',key=>{
 const report=evidence();report.identity[key]=key==='sourceHands'?100: 'wrong';
 expect(()=>validateMatchedWriterEvidence(report,identity())).toThrow();
});
it.each(['sourceTriggerCatalogRestored','observerFunctionMetadataRestored','sourceFunctionsRestored'])('rejects missing restoration proof %s',key=>{
 const report=evidence();report[key]=false;
 expect(()=>validateMatchedWriterEvidence(report,identity())).toThrow();
});
it('rejects a database bound to another run even when the supplied identities match',()=>{
 const report=evidence();report.identity.database='vinpoker_hud_test_pair_999_2';report.database=report.identity.database;
 expect(()=>validateMatchedWriterEvidence(report,report.identity)).toThrow();
});
it('fails a bad pair even when pooled p95 would pass',()=>{
 const pairs=fixture();for(let i=20;i<35;i++)pairs[0].measurements.incremental.orderedTransactions[i].latencyMs=3;
 const result=matchedWriterStatistics(pairs);expect(result.overheadPercent).toBeCloseTo(5);expect(result.pairs[0].overheadPercent).toBe(200);expect(result.passed).toBe(false);
});
it('rejects missing samples, altered pair order and changed durability',()=>{
 const missing=fixture();missing[0].measurements.incremental.orderedTransactions.pop();expect(()=>matchedWriterStatistics(missing)).toThrow();
 const order=fixture();order[1].order.reverse();expect(()=>matchedWriterStatistics(order)).toThrow();
 const durability=fixture();durability[2].measurements.incremental.configuration.fsync='off';expect(()=>matchedWriterStatistics(durability)).toThrow();
});
