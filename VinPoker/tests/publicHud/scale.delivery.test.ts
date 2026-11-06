import {it,expect} from 'vitest';
import {handIncludesWrite,projectionIncludesWrite,settleScopedFeltRead,coveringTableHintTiming,createCoveringHintDiagnostics} from './scale.delivery.mjs';
it('keeps exact signed p95 timings and counts unavailable pairs separately',()=>{
 const diagnostics=createCoveringHintDiagnostics();
 expect(diagnostics.summary()).toEqual({samples:0,matched:0,outcomes:{},sourceToHintP95Ms:null,hintToReadStartP95Ms:null,readToObservationP95Ms:null,readsStartedBeforeHint:0});
 for(let n=1;n<=100;n++)diagnostics.record({state:'matched',sourceToHintMs:n,hintToReadStartMs:-n,readToObservationMs:20});
 diagnostics.record({state:'deferred-source'});
 expect(diagnostics.summary()).toEqual({samples:101,matched:100,outcomes:{matched:100,'deferred-source':1},sourceToHintP95Ms:95,hintToReadStartP95Ms:-6,readToObservationP95Ms:20,readsStartedBeforeHint:100});
});
it('pairs a retained covering hint even when it arrived before the source HTTP acknowledgement',()=>{
 const expected={at:1000,generation:'9007199254740993',generationDeferred:false};
 const observation={startedAt:1050,at:1300};
 const hints=[{generation:'9999999999999999',at:990},{generation:'9007199254740992',at:1010},
  {generation:'9007199254740993',at:1100},{generation:'9007199254740994',at:1200}];
 const timing=coveringTableHintTiming(hints,expected,observation);
 expect(timing).toEqual({state:'matched',sourceToHintMs:100,hintToReadStartMs:-50,readToObservationMs:250});
 expect(timing.sourceToHintMs+timing.hintToReadStartMs+timing.readToObservationMs).toBe(observation.at-expected.at);
});
it('does not invent timings for deferred, unknown or unobserved generations',()=>{
 const expected={at:1000,generation:'10',generationDeferred:false},observation={startedAt:1100,at:1200};
 expect(coveringTableHintTiming([{generation:'10',at:1300}],expected,observation)).toEqual({state:'no-retained-covering-hint'});
 expect(coveringTableHintTiming([{generation:'9',at:1050}],expected,observation)).toEqual({state:'no-retained-covering-hint'});
 expect(coveringTableHintTiming([],{...expected,generationDeferred:true},observation)).toEqual({state:'deferred-source'});
 expect(coveringTableHintTiming([],{...expected,generation:'untrusted'},observation)).toEqual({state:'unknown-generation'});
 expect(coveringTableHintTiming([{generation:'untrusted',at:1050}],expected,observation)).toEqual({state:'no-retained-covering-hint'});
});
it('credits only a completed or demonstrably newer observed hand',()=>{
 const write={handId:'hand',number:8,step:5};
 expect(handIncludesWrite({id:'hand',handNumber:8,status:'in_progress',actions:[1,2,3,4]},write)).toBe(false);
 expect(handIncludesWrite({id:'hand',handNumber:8,status:'completed'},write)).toBe(true);
 expect(handIncludesWrite({id:'other',handNumber:7,status:'completed'},write)).toBe(false);
 expect(handIncludesWrite({id:'next',handNumber:9,status:'in_progress'},write)).toBe(true);
 expect(handIncludesWrite({id:'source-matrix-fixture',handNumber:9_000_000,status:'in_progress'},{handId:'measured',number:20_100_000,step:1})).toBe(false);
});
it('accepts an included generation while newer writes wait but fences deferred work',()=>{
 const write={generation:'10',at:1000,deferred:false,ackOrder:5};
 const freshness={projectedSourceRevision:'{"generation":"10"}',publishedAt:new Date(1001).toISOString(),state:'updating'};
 expect(projectionIncludesWrite(freshness,write)).toBe(true);
 expect(projectionIncludesWrite(freshness,{...write,generation:'11'})).toBe(false);
 expect(projectionIncludesWrite(freshness,{...write,at:1002})).toBe(false);
 expect(projectionIncludesWrite(freshness,{...write,deferred:true})).toBe(false);
 expect(projectionIncludesWrite({...freshness,state:'current'},{...write,deferred:true},6)).toBe(false);
 const absorbed={...freshness,state:'current',projectedSourceRevision:'{"generation":"11"}'};
 expect(projectionIncludesWrite(absorbed,{...write,deferred:true},5)).toBe(false);
 expect(projectionIncludesWrite(absorbed,{...write,deferred:true},6)).toBe(true);
});

it('keeps the next felt read full when its fast clock preceded a superseded table',async()=>{
 let resolveTable!:(value:{access:string})=>void;
 const table=new Promise<{access:string}>(resolve=>{resolveTable=resolve;});
 let epoch=0,ready=false,commits=0;
 const requestEpoch=epoch;
 const pending=settleScopedFeltRead(table,Promise.resolve(true),
  (reply:{access:string})=>epoch===requestEpoch&&reply.access==='public',()=>{ready=true;commits++;});
 await Promise.resolve();await Promise.resolve();expect(ready).toBe(false);
 epoch++;resolveTable({access:'public'});await pending;
 expect(ready).toBe(false);expect(commits).toBe(0);
 const nextRequiresClock=!ready;expect(nextRequiresClock).toBe(true);
 await settleScopedFeltRead(Promise.resolve({access:'public'}),Promise.resolve(nextRequiresClock),
  (reply:{access:string})=>reply.access==='public',()=>{ready=true;commits++;});
 expect(ready).toBe(true);expect(commits).toBe(1);
});

it('rejects a late clock cache commit after withdrawal or reconnect',async()=>{
 for(const cause of ['withdrawal','reconnect']){
  let finishClock!:(valid:boolean)=>void;
  const clock=new Promise<boolean>(resolve=>{finishClock=resolve;});let current=true,commits=0;
  const pending=settleScopedFeltRead(Promise.resolve({access:'public'}),clock,()=>current,()=>{commits++;});
  await Promise.resolve();current=false;finishClock(true);await pending;
  expect(commits,cause).toBe(0);
 }
});

it('keeps denied tables, invalid clocks and transport failures out of the clock cache',async()=>{
 let commits=0;
 await settleScopedFeltRead(Promise.resolve({access:'revoked'}),Promise.resolve(true),
  (reply:{access:string})=>reply.access==='public',()=>{commits++;});
 await settleScopedFeltRead(Promise.resolve({access:'public'}),Promise.resolve(false),()=>true,()=>{commits++;});
 for(const failed of ['table','clock']){
  const failure=new Error(failed+'_deadline');
  await expect(settleScopedFeltRead(failed==='table'?Promise.reject(failure):Promise.resolve({access:'public'}),
   failed==='clock'?Promise.reject(failure):Promise.resolve(true),()=>true,()=>{commits++;})).rejects.toBe(failure);
 }
 expect(commits).toBe(0);
});
