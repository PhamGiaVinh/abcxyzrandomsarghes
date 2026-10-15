// Execute the actual standalone callback; dependency adapters are synthetic.
// This complements DB tests, not a React/browser or HTTP/commit acceptance claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseSync,transformSync} from '@swc/core';
import * as finish from '../../src/lib/trackerManualFinish.ts';
import {createSingleFlightGuard} from '../../src/lib/singleFlight.ts';
import {waitForManualPlayerResponse} from '../../src/lib/floorManualPlayerIntent.ts';
import {observeTrackerContextRead} from '../../src/lib/tournament/observeTrackerContextRead.ts';
import {buildRecordHandBody,readEdgeError} from '../../src/components/cashier/tournament-live/handinput/handInputEdge.ts';
import {computePotBreakdown,contributionsFromActions,toSidePotsJson} from '../../src/lib/tracker-poker/potEngine.ts';
const source=readFileSync('src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts','utf8');
const ast=parseSync(source,{syntax:'typescript'});let callback;
function visit(node){if(!node||typeof node!=='object')return;if(node.type==='VariableDeclaration'&&node.declarations.some(d=>d.id.value==='handleSubmitHand'))callback=node;for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
visit(ast);assert.ok(callback);
const compiled=transformSync({...ast,body:[callback]},{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code+';return handleSubmitHand;';
const actor='81400000-0000-4000-8000-000000000001',tour='85000000-0000-4000-8000-000000000001',table='84000000-0000-4000-8000-000000000001',hand='86000000-0000-4000-8000-000000000001',session='83500000-0000-4000-8000-000000000001';
function proof(i){return {ok:true,status:'success',hand_id:i.hand_id,actor_id:i.actor_id,request_id:i.request_id,intent:i,table_session_id:i.table_session_id,control_epoch:i.control_epoch,expected_source_revision:i.source_revision,committed_source_revision:i.source_revision+1,starting_total:1000,ending_total:1000};}
const notFound={data:{error:'receipt_not_found',code:'receipt_not_found'},error:null};
function harness(){
 const stored=new Map(),calls=[],effects=[],errors=[];let invoke;
 const state={submitting:false,write:async i=>({data:{status:'success',data:proof(i)},error:null}),read:async()=>notFound};
 const deps={...finish,buildRecordHandBody,readEdgeError,computePotBreakdown,contributionsFromActions,toSidePotsJson,waitForManualPlayerResponse,observeTrackerContextRead,
  user:{id:actor},tournamentId:tour,tableId:table,handId:hand,handNumber:1,workflowState:'submit_ready',endingStacks:{a:500,b:500},conservationOk:true,endingStacksManuallyEdited:false,
  rosterContext:{tableSessionId:session,tournamentTableId:table,controlEpoch:1},tableLoadState:'ready',loadedTablesTournamentRef:{current:tour},
  rosterMountedRef:{current:true},rosterGenerationRef:{current:1},actionScopeRef:{current:'scope'},tableLoadGuardRef:{current:{capture:()=>({generation:1}),isCurrent:t=>t.generation===deps.rosterGenerationRef.current}},
  handSubmitGuardRef:{current:createSingleFlightGuard()},finishOwnsSubmittingRef:{current:false},setSubmitting:v=>{state.submitting=v;},markSync:(...a)=>effects.push(['sync',...a]),
  sessionStorage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},crypto:globalThis.crypto,Response,
  players:[{player_id:'a',entry_number:1,seat_number:1,starting_stack:500,current_stack:500},{player_id:'b',entry_number:1,seat_number:2,starting_stack:500,current_stack:500}],
  communityCards:[],potSize:0,playerHoleCards:{},actions:[],
  toast:{error:m=>errors.push(m),info:m=>errors.push(m),warning:m=>errors.push(m),success:m=>effects.push(['success',m])},
  ensureRecordedHandDisplayOutcome:async input=>{effects.push(['outcome',input]);return {ok:true};},playTrackerSoundOnce:()=>effects.push(['sound']),playedSoundsRef:{current:new Set()},
  setLastHandId:v=>effects.push(['last',v]),FEATURES:{floorDeferredTrackerMoveV1:true},availableTables:[{id:table,tableSessionId:session}],
  setHandId:v=>effects.push(['hand',v]),setHandStarted:v=>effects.push(['started',v]),resetHand:()=>effects.push(['reset']),handleTableChange:async()=>effects.push(['reload']),
  supabase:{auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},functions:{invoke:async(_name,{body})=>{calls.push(body);assert.equal(stored.size,1,'journal durable before every write/lookup');return body.action==='record_manual_hand_v1'?state.write(body.finish_intent):state.read(body.finish_intent);}},
   from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({error:null,data:{id:hand,tournament_id:tour,table_id:table,tournament_table_id:table,table_session_id:session,source_revision:12,status:'in_progress',is_voided:false}})};return q;}},
 };
 invoke=Function(...Object.keys(deps),compiled)(...Object.values(deps));
 return {deps,state,stored,calls,effects,errors,submit:invoke};
}
test('successful exact proof applies the hand and clears only its own journal',async()=>{
 const h=harness();await h.submit();assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'record_manual_hand_v1');assert.equal(h.stored.size,0);assert.equal(h.effects.filter(x=>x[0]==='outcome').length,1);assert.equal(h.state.submitting,false);
});
test('lost response reconciles the exact server receipt without retrying writer',async()=>{
 const h=harness();let sent;h.state.write=async i=>{sent=i;return {data:null,error:new Error('response lost')};};h.state.read=async()=>({data:{data:proof(sent)},error:null});
 await h.submit();assert.deepEqual(h.calls.map(x=>x.action),['record_manual_hand_v1','get_manual_finish_receipt_v1']);assert.equal(h.stored.size,0);assert.equal(h.effects.filter(x=>x[0]==='outcome').length,1);
});
test('explicit retry preserves UUID and frozen hand_time after unknown outcome',async()=>{
 const h=harness();h.state.write=async()=>({data:null,error:new Error('lost')});await h.submit();assert.equal(h.stored.size,1);const first=h.calls[0].finish_intent;
 h.state.write=async i=>({data:{data:proof(i)},error:null});await h.submit();const writes=h.calls.filter(x=>x.action==='record_manual_hand_v1');assert.equal(writes.length,2);assert.deepEqual(writes[1].finish_intent,first);assert.equal(h.stored.size,0);
});
test('changed draft cannot replace unresolved payload or mint a new key',async()=>{
 const h=harness();h.state.write=async()=>({data:null,error:new Error('lost')});await h.submit();const saved=[...h.stored.values()][0];h.deps.endingStacks.a=400;h.deps.endingStacks.b=600;
 await h.submit();assert.equal(h.calls.filter(x=>x.action==='record_manual_hand_v1').length,1);assert.equal([...h.stored.values()][0],saved);
});
test('late A completion after A B A does not adopt current generation or clear journal',async()=>{
 const h=harness();let resolve,sent;h.state.write=i=>{sent=i;return new Promise(done=>{resolve=done;});};const pending=h.submit();while(!resolve)await new Promise(done=>setTimeout(done,0));
 h.deps.rosterGenerationRef.current+=2;resolve({data:{data:proof(sent)},error:null});await pending;
 assert.equal(h.effects.filter(x=>['outcome','success','reset','sound'].includes(x[0])).length,0);assert.equal(h.stored.size,1);
});
test('mismatched proof cannot be replaced by a completed/pot readback',async()=>{
 const h=harness();h.state.write=async i=>({data:{data:{...proof(i),hand_id:'other-hand'}},error:null});await h.submit();assert.equal(h.effects.filter(x=>x[0]==='outcome').length,0);assert.equal(h.stored.size,1);assert.equal(h.calls.filter(x=>x.action==='record_manual_hand_v1').length,1);
});
test('storage failure prevents mutation, while definitive first denial permits correction',async()=>{
 const h=harness();h.deps.sessionStorage.setItem=()=>{throw new Error('storage denied');};await h.submit();assert.equal(h.calls.length,0);
 const denied=harness();denied.state.write=async()=>({data:{error:'lock_not_held',code:'lock_not_held'},error:null});await denied.submit();assert.equal(denied.stored.size,0);assert.equal(denied.calls.length,1);
});
test('double-click remains a single writer and a corrupt journal never starts a replacement',async()=>{
 const h=harness();await Promise.all([h.submit(),h.submit()]);assert.equal(h.calls.filter(x=>x.action==='record_manual_hand_v1').length,1);
 const broken=harness();broken.stored.set(`vinpoker:manual-finish:${actor}:${tour}:${table}:${hand}`,'not-json');await broken.submit();assert.equal(broken.calls.length,0);assert.equal(broken.stored.size,1);
});
test('changed epoch only reconciles unresolved original intent and does not resend it',async()=>{
 const h=harness();h.state.write=async()=>({data:null,error:new Error('lost')});await h.submit();const saved=[...h.stored.values()][0];h.deps.rosterContext.controlEpoch=2;await h.submit();
 assert.equal(h.calls.filter(x=>x.action==='record_manual_hand_v1').length,1);assert.equal([...h.stored.values()][0],saved);
});
test('journal CAS prevents a late settlement from deleting another pending request',()=>{
 const h=harness();const i={actor_id:actor,tournament_id:tour,tournament_table_id:table,hand_id:hand,request_id:crypto.randomUUID(),table_session_id:session,control_epoch:1,source_revision:12,payload:{hand_time:new Date().toISOString(),players:[{}],actions:[],side_pots:[],community_cards:[],pot_size:0}};
 finish.persistManualFinishJournal(h.deps.sessionStorage,'key',i);const later={...i,request_id:crypto.randomUUID()};h.stored.set('key',JSON.stringify(later));
 assert.throws(()=>finish.settleManualFinishJournal(h.deps.sessionStorage,'key',i),/JOURNAL_CHANGED/);assert.equal(JSON.parse(h.stored.get('key')).request_id,later.request_id);
});
test('verified server commit is not downgraded when journal cleanup fails',async()=>{
 const h=harness();h.deps.sessionStorage.removeItem=()=>{throw new Error('storage cleanup denied');};await h.submit();
 assert.equal(h.effects.filter(x=>x[0]==='outcome').length,1);assert.equal(h.stored.size,1);assert.equal(h.calls.filter(x=>x.action==='record_manual_hand_v1').length,1);
});
