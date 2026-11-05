import {it,expect} from 'vitest';
import {matchedWriterStatistics} from './scale.write.protocol.mjs';
const fixture=()=>Array.from({length:3},(_,index)=>({pair:index+1,order:index%2?['incremental','withoutHudMarker']:['withoutHudMarker','incremental'],measurements:Object.fromEntries(['incremental','withoutHudMarker'].map(arm=>[arm,{configuration:{fsync:'on',fullPageWrites:'on',synchronousCommit:'on',commit:true,pgbenchProtocol:'prepared',clients:1,threads:1},orderedTransactions:Array.from({length:220},(_,i)=>({client:0,script:0,transaction:i,latencyMs:arm==='incremental'?1.05:1,epochSeconds:1700000000,epochMicros:i,warmup:i<20}))}]))}));
it('uses all600 raw graded samples per arm with fixed warmup and pair order',()=>{
 const result=matchedWriterStatistics(fixture());expect(result.gradedPerArm).toBe(600);expect(result.overheadPercent).toBeCloseTo(5);expect(result.passed).toBe(true);
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
