import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReadQualification} from './qualification.mjs';
function complete(){return {elapsedMs:1800000,documents:100000,months:12,financialFactsUnchanged:true,
  samples:Array.from({length:7200},(_,i)=>({actor:Math.floor(i/360),slot:i%360,
    kind:i%2===0?'report':'statement',ok:true,latencyMs:100}))};}
test('accepts exactly the twenty-actor thirty-minute read workload',()=>{
  assert.equal(summarizeReadQualification(complete()).qualification,true);
});
test('short, duplicate, missing, wrong-shape or mutated data cannot qualify',()=>{
  for(const change of [v=>{v.elapsedMs=1799000;},v=>{v.documents=99999;},v=>{v.months=1;},
    v=>{v.financialFactsUnchanged=false;},v=>{v.samples.pop();},v=>{v.samples[1]=v.samples[0];},
    v=>{v.samples[1].actor=20;},v=>{v.samples[1].latencyMs=NaN;},v=>{v.terminalError='setup';}]) {
    const v=complete();change(v);assert.equal(summarizeReadQualification(v).qualification,false);
  }
});
test('one timeout or unfinished sample fails even with an otherwise fast p95',()=>{
  const v=complete();v.samples[0]={...v.samples[0],ok:false,error:'timeout',latencyMs:5001};
  let r=summarizeReadQualification(v);assert.equal(r.qualification,false);assert.equal(r.results.report.errors,1);
  v.samples[0]={...v.samples[0],incomplete:true,latencyMs:1800000};
  r=summarizeReadQualification(v);assert.equal(r.results.report.maxMs,1800000);assert.equal(r.qualification,false);
});
test('the two endpoint latency gates are separate and include every sample',()=>{
  for(const [kind,slow] of [['report',5001],['statement',2001]]) {
    const v=complete();for(const s of v.samples) if(s.kind===kind)s.latencyMs=slow;
    const r=summarizeReadQualification(v);assert.equal(r.qualification,false);assert.equal(r.results[kind].p95Ms,slow);
  }
});
test('incomplete and timeout markers cannot be hidden behind ok true',()=>{
  for(const marker of [{incomplete:true},{error:'timeout'}]) {
    const v=complete();Object.assign(v.samples[0],marker);
    const r=summarizeReadQualification(v);
    assert.equal(r.qualification,false);assert.equal(r.results.report.errors,1);
  }
});
