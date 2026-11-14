import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationalHandDeliveryEvidence,validateOperationalFinishReceipt,validateHandDeliverySelection,readHandDeliveryJournal} from './operations-audience-hand-delivery.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const receipt=(n=0)=>({kind:'verified-canonical-finish-v1',tournamentId:'a3000000-0000-4000-8000-000000000001',
 tableId:id(1),sessionId:id(2),handId:id(10+n),handNumber:9003+n,startIntentAt:800+n*1000,startAckAt:900+n*1000,intentAt:1000+n*1000,ackAt:1100+n*1000,verifiedAt:1200+n*1000});
const scope={tournamentId:receipt().tournamentId,tableId:receipt().tableId};
const sha='a'.repeat(40);
const selection={kind:'select-operational-table-v1',sha,nonce:id(4),...scope,sessionId:receipt().sessionId};
test('journal binds exact checkout, selection nonce and session and ignores only incomplete append',()=>{
 assert.deepEqual(validateHandDeliverySelection(selection,sha),selection);
 const row={sha,nonce:selection.nonce,receipt:receipt()},line=JSON.stringify(row)+'\n';
 assert.deepEqual(readHandDeliveryJournal(line+'{"incomplete":',selection),[receipt()]);
 for(const invalid of [{...row,sha:'b'.repeat(40)},{...row,nonce:id(5)},{...row,secret:'forbidden'},
  {...row,receipt:{...receipt(),sessionId:id(9)}}])assert.throws(()=>readHandDeliveryJournal(JSON.stringify(invalid)+'\n',selection));
 assert.throws(()=>readHandDeliveryJournal('invalid\n',selection));
 assert.throws(()=>readHandDeliveryJournal('x'.repeat(65537),selection));
 assert.throws(()=>readHandDeliveryJournal(line.repeat(21),selection));
 assert.throws(()=>validateHandDeliverySelection({...selection,sha:'b'.repeat(40)},sha));
 assert.throws(()=>validateHandDeliverySelection({...selection,token:'forbidden'},sha));
});
const frame=(r=receipt())=>({access:'public',tournamentId:r.tournamentId,tableId:r.tableId,tableSessionId:r.sessionId,
 hand:{id:r.handId,tableId:r.tableId,tableSessionId:r.sessionId,handNumber:r.handNumber,status:'completed',pot:200,actions:Array.from({length:5},()=>({}))}});
test('credits exact completed hand observations before the verified receipt arrives',()=>{
 const e=createOperationalHandDeliveryEvidence(10);e.observe(0,scope,frame(),1050);e.receipt(receipt());
 assert.equal(e.report().matchedDeliveries,1);assert.equal(e.report().p95Ms,50);assert.equal(e.report().complete,false);
 e.receipt(receipt());assert.equal(e.report().matchedDeliveries,1);
});
test('unrelated generation, table, session, incomplete hand and wrong payload never credit Finish',()=>{
 for(const change of [f=>({...f,sourceGeneration:'999'}),f=>({...f,tableId:id(9)}),f=>({...f,tableSessionId:id(9)}),
  f=>({...f,hand:{...f.hand,status:'in_progress'}}),f=>({...f,hand:{...f.hand,pot:201}}),f=>({...f,hand:{...f.hand,actions:[]}})]){
  const e=createOperationalHandDeliveryEvidence(10);e.receipt(receipt());const f=change(frame());
  if(f.sourceGeneration)f.hand.id=id(99);
  e.observe(0,scope,f,1300);assert.equal(e.report().matchedDeliveries,0);
 }
});
test('later hand only covers an earlier state after its own ordered canonical receipt is verified',()=>{
 const e=createOperationalHandDeliveryEvidence(10);e.receipt(receipt());
 const later=frame(receipt(1));later.hand.status='in_progress';later.hand.actions=[];
 e.observe(0,scope,later,2050);assert.equal(e.report().matchedDeliveries,0);
 e.receipt(receipt(1));assert.equal(e.report().matchedDeliveries,1);assert.equal(e.report().coalescedFrames,1);
});
test('rejects foreign scope, unknown fields, conflicting retries and clock/order drift',()=>{
 for(const bad of [{...receipt(),secret:'private'},{...receipt(),tournamentId:id(99)},{...receipt(),intentAt:1300}])assert.throws(()=>validateOperationalFinishReceipt(bad));
 const e=createOperationalHandDeliveryEvidence(10);e.receipt(receipt());
 assert.throws(()=>e.receipt({...receipt(),ackAt:1150}),/Conflicting/);
 assert.throws(()=>e.receipt(receipt(2)),/reordered/);
 assert.throws(()=>e.receipt({...receipt(1),sessionId:id(99)}),/scope/);
 assert.throws(()=>e.receipt({...receipt(1),startIntentAt:1150,startAckAt:1160}),/Overlapping serial start/);
 assert.equal(JSON.stringify(e.report()).includes('private'),false);
});
test('complete requires all twenty actual receipts and every viewer, not a few fast samples',()=>{
 const e=createOperationalHandDeliveryEvidence(10);
 for(let n=0;n<20;n++){const r=receipt(n);e.receipt(r);for(let v=0;v<9;v++)e.observe(v,scope,frame(r),r.verifiedAt);}
 assert.equal(e.report().complete,false);assert.equal(e.report().missingDeliveries,20);
 // A final verified later hand covers all earlier ordered states for this last viewer.
 e.observe(9,scope,frame(receipt(19)),receipt(19).verifiedAt);
 assert.equal(e.report().matchedDeliveries,200);assert.equal(e.report().complete,true);
 assert.ok(e.report().p95Ms>3000,'Complete alone must not bypass the separate3s latency gate');
});

test('request scope binds readers whose canonical public wire omits tournamentId',()=>{
 const e=createOperationalHandDeliveryEvidence(10),f=frame();delete f.tournamentId;e.receipt(receipt());e.observe(0,scope,f,1300);assert.equal(e.report().matchedDeliveries,1);
 assert.throws(()=>e.observe(1,{...scope,tournamentId:id(99)},f,1300),/requested table scope/);
 e.observe(1,{...scope,tableId:id(99)},f,1300);assert.equal(e.report().matchedDeliveries,1);
});

test('optional phase timing preserves the original credited frame, signed clocks and delivery gate',()=>{
 const plain=createOperationalHandDeliveryEvidence(10),timed=createOperationalHandDeliveryEvidence(10);
 plain.receipt(receipt());timed.receipt(receipt());
 const timing={pendingAt:800,dispatchAt:900,headersAt:1005,bodyReadyAt:1250};
 plain.observe(0,scope,frame(),1300);timed.observe(0,scope,frame(),1300,timing);
 assert.deepEqual(timed.report(),plain.report());assert.equal(timed.report().diagnostics,undefined);
 timing.dispatchAt=1; // Caller mutation must not rewrite credited evidence.
 timed.observe(0,scope,frame(),1400,{pendingAt:1310,dispatchAt:1320,headersAt:1330,bodyReadyAt:1350});
 const diagnostic=timed.report({diagnostics:true}).diagnostics,row=diagnostic.perHand[0];
 assert.equal(diagnostic.timedMatches,1);assert.equal(diagnostic.untimedMatches,0);
 assert.equal(row.finishIntentToAckMs,100);assert.equal(row.delivery.p95Ms,300);
 assert.equal(row.stages.intentToDispatchMs.minMs,-100);
 assert.equal(row.stages.oldestRequestToDispatchMs.p95Ms,100);
 assert.equal(row.stages.dispatchToHeadersMs.p95Ms,105);
 assert.equal(row.stages.headersToBodyMs.p95Ms,245);
 assert.equal(row.stages.bodyToConsumerMs.p95Ms,50);
 assert.equal(timed.report().complete,false);
});

test('phase diagnostics follow the same coalesced hand match, not a faster replacement frame',()=>{
 const e=createOperationalHandDeliveryEvidence(10);e.receipt(receipt());
 const later=frame(receipt(1));later.hand.status='in_progress';later.hand.actions=[];
 e.observe(0,scope,later,2050,{pendingAt:1900,dispatchAt:1950,headersAt:2005,bodyReadyAt:2040});
 e.receipt(receipt(1));
 const report=e.report({diagnostics:true});
 assert.equal(report.matchedDeliveries,1);assert.equal(report.p95Ms,1050);
 assert.equal(report.diagnostics.perHand[0].coalescedFrames,1);
 assert.equal(report.diagnostics.perHand[0].stages.intentToDispatchMs.p95Ms,950);
 assert.equal(report.diagnostics.perHand[1].delivery.samples,0);
 assert.equal(report.diagnostics.perHand[1].delivery.p95Ms,null);
});

test('diagnostics reject unknown fields/order drift and retain untimed matches without inventing zero timings',()=>{
 const e=createOperationalHandDeliveryEvidence(10);e.receipt(receipt());
 const timing={pendingAt:900,dispatchAt:1000,headersAt:1100,bodyReadyAt:1200};
 for(const invalid of [{...timing,token:'private'},{...timing,headersAt:999},{...timing,bodyReadyAt:1301},{...timing,pendingAt:0}])
  assert.throws(()=>e.observe(0,scope,frame(),1300,invalid));
 assert.equal(e.report().matchedDeliveries,0);
 e.observe(0,scope,frame(),1300);
 const report=e.report({diagnostics:true});
 assert.equal(report.matchedDeliveries,1);assert.equal(report.diagnostics.timedMatches,0);
 assert.equal(report.diagnostics.untimedMatches,1);
 assert.equal(report.diagnostics.perHand[0].stages.dispatchToHeadersMs.p95Ms,null);
 assert.doesNotMatch(JSON.stringify(report),/private/);
});

test('final diagnostics export at most twenty per-hand rows and ten worst scalar samples',()=>{
 const e=createOperationalHandDeliveryEvidence(10);
 for(let n=0;n<20;n++){const r=receipt(n);e.receipt(r);for(let v=0;v<10;v++)e.observe(v,scope,frame(r),r.verifiedAt);}
 const before=e.report(),after=e.report({diagnostics:true});
 assert.equal(after.diagnostics.perHand.length,20);assert.equal(after.diagnostics.worstSamples.length,10);
 const {diagnostics,...unchanged}=after;assert.deepEqual(unchanged,before);
 assert.equal(after.matchedDeliveries,200);assert.equal(after.complete,true);
});
