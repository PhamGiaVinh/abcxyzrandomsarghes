import {describe,it,expect} from 'vitest';
import {maximumSample,summaryApiReport} from './scale.summary.mjs';
it('reports the peak of a million samples without spreading function arguments',()=>{
 const samples=Array.from({length:1000000},(_,i)=>i);
 expect(maximumSample(samples)).toBe(999999);expect(maximumSample([])).toBe(0);
});
describe('API and logical preparation timing stay separate',()=>{
 it('does not let fast unavailable replies dilute the ready-summary gate',()=>{
  const samples=[...Array.from({length:96},()=>({ms:1,phase:'access',state:'unavailable',ready:false})),...Array.from({length:4},()=>({ms:2000,phase:'access',state:'current',ready:true}))];
  const report=summaryApiReport(samples);
  expect(report.all).toEqual({samples:100,p95Ms:1});expect(report.ready).toEqual({samples:4,p95Ms:2000});expect(report.states).toEqual({unavailable:96,current:4});
  expect(report.byPhase.access.ready.p95Ms).toBe(2000);
 });
 it('retains separate opening/revalidation phases and explicit missing ready samples',()=>{
  const report=summaryApiReport([{ms:20,phase:'opening',state:'current',ready:true},{ms:5,phase:'revalidation',state:'unavailable',ready:false}]);
  expect(report.ready).toEqual({samples:1,p95Ms:20});expect(report.byPhase.revalidation.ready).toEqual({samples:0,p95Ms:null});expect(summaryApiReport([]).all).toEqual({samples:0,p95Ms:null});
 });
});
