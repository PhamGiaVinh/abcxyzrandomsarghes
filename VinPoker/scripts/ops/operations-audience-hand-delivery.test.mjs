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
