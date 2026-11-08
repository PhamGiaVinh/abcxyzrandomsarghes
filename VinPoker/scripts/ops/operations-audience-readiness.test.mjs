import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audienceSelectionReadiness,recordAudienceDetailEvent} from './operations-audience-scope.mjs';
const selection={tableId:'private-table',sessionId:'private-session'};
const ready={online:true,ready:true,clockReady:true,tableId:selection.tableId,observedSession:selection.sessionId};
test('no selection reports unknown; all five actual readiness conditions must hold',()=>{
 assert.equal(audienceSelectionReadiness([],null),null);
 assert.equal(audienceSelectionReadiness([ready],selection).counts.missing,0);
 const clients=[{...ready,online:false},{...ready,ready:false},{...ready,clockReady:false},
  {...ready,tableId:'old-table'},{...ready,observedSession:'old-session'}];
 const report=audienceSelectionReadiness(clients,selection);
 assert.deepEqual(report.counts,{missing:5,offline:1,tableNotReady:1,clockNotReady:1,wrongTable:1,wrongSession:1,inFlight:0});
});
test('diagnostics distinguish an unfinished request, fencing and rejected reads without arbitrary state',()=>{
 const report=audienceSelectionReadiness([{...ready,ready:false,detailStartedAt:100,detailInFlight:true,
  detailStarted:4,detailAccepted:1,detailFenced:2,detailRejected:1,lastDetailFull:true,detailFullReads:3,clockCommits:1,clockInvalidations:2,secret:'never-copy',error:Error('never-copy')}],selection,120);
 assert.deepEqual(report.samples,[{index:0,offline:false,tableNotReady:true,clockNotReady:false,wrongTable:false,wrongSession:false,
  inFlight:true,lastRequestAgeMs:20,started:4,accepted:1,fenced:2,rejected:1,lastDetailFull:true,fullReads:3,clockCommits:1,clockInvalidations:2,trace:[]}]);
 assert.doesNotMatch(JSON.stringify(report),/private-|never-copy|old-session/);
});
test('bounded ordered trace distinguishes clock reset from a fenced full read without copying state',()=>{
 const state={...ready,clockReady:false,epoch:2,lastDetailFull:true,secret:'never-copy'};
 recordAudienceDetailEvent(state,'selection',100);recordAudienceDetailEvent(state,'request',101);
 recordAudienceDetailEvent(state,'dispatch',102);state.epoch=3;recordAudienceDetailEvent(state,'invalidate',103);
 recordAudienceDetailEvent(state,'fenced',104);
 const trace=audienceSelectionReadiness([state],selection,110).samples[0].trace;
 assert.deepEqual(trace.map(x=>[x.event,x.ageMs,x.epoch]),[['selection',10,2],['request',9,2],['dispatch',8,2],['invalidate',7,3],['fenced',6,3]]);
 assert.ok(trace.every(x=>x.full&&!x.clockReady));
 for(let i=0;i<20;i++)recordAudienceDetailEvent(state,'request',111+i);
 assert.equal(state.detailTrace.length,12);assert.doesNotMatch(JSON.stringify(state.detailTrace),/never-copy/);
 assert.throws(()=>recordAudienceDetailEvent(state,'arbitrary secret'),/Unknown detail diagnostic event/);
});
test('1000 incomplete viewers retain counts but at most20 numeric-index samples',()=>{
 const clients=Array.from({length:1000},()=>({...ready,clockReady:false}));
 const report=audienceSelectionReadiness(clients,selection,120);
 assert.equal(report.counts.missing,1000);assert.equal(report.samples.length,20);
 assert.equal(report.samples[0].lastRequestAgeMs,null);
 assert.deepEqual(report.samples.map(x=>x.index),Array.from({length:20},(_,i)=>i));
});
