import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReadQualification} from './load-qualification.mjs';
const baseline=()=>({elapsedMs:1800000,documents:100000,lines:500000,months:12,
  financialFactsUnchanged:true,catalogFactsUnchanged:true,terminalError:null,
  samples:Array.from({length:20},(_,actor)=>Array.from({length:360},(_,slot)=>({actor,slot,
    kind:slot%2===0?'history':'statement',ok:true,error:null,queueMs:0,latencyMs:10}))).flat()});
test('qualifies only the complete standalone self-history/detail workload',()=>{
  const result=summarizeReadQualification(baseline());
  assert.equal(result.qualification,true);assert.equal(result.results.history.count,3600);
  assert.equal(result.results.statement.count,3600);
});
test('refuses wrong data volumes, changed facts, catalog and terminal errors',()=>{
  for(const [key,value] of [['documents',99999],['lines',499999],['months',11],['financialFactsUnchanged',false],
    ['catalogFactsUnchanged',false],['terminalError','request_error']]){
    assert.equal(summarizeReadQualification({...baseline(),[key]:value}).qualification,false,key);
  }
});
test('requires the actual full monotonic window without shortening or excessive overrun',()=>{
  for(const elapsedMs of [1799999.99,1815000.01]) assert.equal(summarizeReadQualification({...baseline(),elapsedMs}).qualification,false);
});
test('refuses missing duplicate foreign or wrongly scheduled samples',()=>{
  for(const change of [p=>p.samples.pop(),p=>p.samples[1]={...p.samples[0]},p=>p.samples[0].actor=20,
    p=>p.samples[0].actor=0.5,p=>p.samples[0].kind='statement']){
    const p=baseline();change(p);assert.equal(summarizeReadQualification(p).qualification,false);
  }
});
test('refuses any error or incomplete result even with ok:true and a fast p95',()=>{
  for(const patch of [{error:'timeout'},{incomplete:true},{ok:false},{latencyMs:NaN},{latencyMs:-1},{queueMs:11},
    {queueMs:NaN},{queueMs:-1}]){
    const p=baseline();Object.assign(p.samples[0],patch);assert.equal(summarizeReadQualification(p).qualification,false,JSON.stringify(patch));
  }
});
test('retains separate 2s p95 gates for history and detail, and reports all failures',()=>{
  for(const kind of ['history','statement']){
    const p=baseline();p.samples.filter(s=>s.kind===kind).forEach(s=>s.latencyMs=2001);
    assert.equal(summarizeReadQualification(p).qualification,false,kind);
  }
  const p=baseline();p.samples[0].error='timeout';p.samples[0].latencyMs=5000;
  const r=summarizeReadQualification(p);assert.equal(r.results.history.errors,1);assert.equal(r.results.history.maxMs,5000);
});
