import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audienceSelectionReadiness} from './operations-audience-scope.mjs';
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
  inFlight:true,lastRequestAgeMs:20,started:4,accepted:1,fenced:2,rejected:1,lastDetailFull:true,fullReads:3,clockCommits:1,clockInvalidations:2}]);
 assert.doesNotMatch(JSON.stringify(report),/private-|never-copy|old-session/);
});
test('1000 incomplete viewers retain counts but at most20 numeric-index samples',()=>{
 const clients=Array.from({length:1000},()=>({...ready,clockReady:false}));
 const report=audienceSelectionReadiness(clients,selection,120);
 assert.equal(report.counts.missing,1000);assert.equal(report.samples.length,20);
 assert.equal(report.samples[0].lastRequestAgeMs,null);
 assert.deepEqual(report.samples.map(x=>x.index),Array.from({length:20},(_,i)=>i));
});
