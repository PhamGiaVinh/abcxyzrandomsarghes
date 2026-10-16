import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';
// Actual client API body with synthetic Edge transport, not authorization proof.
const source=readFileSync(new URL('../../src/lib/trackerVoice/api.ts',import.meta.url),'utf8');
const tree=parseSync(source,{syntax:'typescript'});
function compileBody(name){
const fn=tree.body.find(n=>n.type==='ExportDeclaration'&&n.declaration.identifier?.value===name)?.declaration;
assert.ok(fn);
const text=Buffer.from(source).subarray(fn.span.start-tree.span.start,fn.span.end-tree.span.start).toString()
 .replace('const { supabase } = await import("@/integrations/supabase/client");','const supabase = client;');
assert.ok(!text.includes('await import('));
return transformSync(text+'\n'+name+';',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
}
const code=compileBody('validateTrackerVoiceEvent'),boardCode=compileBody('commitTrackerVoiceBoard'),holeCode=compileBody('commitTrackerVoiceHoleCards'),finishCode=compileBody('commitTrackerVoiceFinish');
const input={tournamentId:'tour',tournamentTableId:'table',handId:'hand',finalTranscript:'check',providerName:'openai_realtime',providerModel:'test',providerEventId:'event',
 executionMode:'assist',expectedStateVersion:'a'.repeat(64),idempotencyKey:'voice:key',traceId:'trace:key'};
const valid=()=>({ok:true,voice_event_id:'voice-event',idempotency_key:input.idempotencyKey,trace_id:input.traceId,state_version:input.expectedStateVersion,
 execution_mode:'assist',execution_result:'validated',correction_pending:false,alert_id:null});
async function invoke(receipt,overrides={}){
 const calls=[];const api=runInNewContext(code,{Error,client:{functions:{invoke:async(...args)=>{calls.push(args);return {data:{data:receipt},error:null};}}}});
 const result=await api({...input,...overrides});assert.equal(calls.length,1);assert.equal(calls[0][0],'tournament-live-update');return result;
}
test('canonical validation and alert receipts remain usable',async()=>{
 for(const receipt of [valid(),{...valid(),execution_result:'alert_opened',alert_id:'alert'}])assert.equal(await invoke(receipt),receipt);
});
for(const [name,patch] of [
 ['truthy ok',{ok:'yes'}],['empty event',{voice_event_id:''}],['missing key',{idempotency_key:undefined}],['wrong key',{idempotency_key:'other:key'}],
 ['wrong trace',{trace_id:'other:trace'}],['wrong proof',{state_version:'b'.repeat(64)}],['wrong mode',{execution_mode:'auto'}],
 ['missing result',{execution_result:undefined}],['missing correction state',{correction_pending:undefined}],['missing alert identity',{execution_result:'alert_opened',alert_id:null}],
 ['duplicate wrong proof',{duplicate:true,state_version:'b'.repeat(64)}],['duplicate wrong mode',{duplicate:true,execution_mode:'auto'}],
 ['duplicate missing key',{duplicate:true,idempotency_key:undefined}],['invalid duplicate marker',{duplicate:'true',idempotency_key:'other'}],
])test(`reject malformed or unbound validation receipt: ${name}`,async()=>{
 await assert.rejects(invoke({...valid(),...patch}),/Voice validation không trả receipt hợp lệ/);
});
test('server-marked duplicate may retain original key/trace without changing proof or mode',async()=>{
 const receipt={...valid(),duplicate:true,idempotency_key:'original:key',trace_id:'original:trace'};assert.equal(await invoke(receipt),receipt);
});
test('SQL Board validation omits alert_id and is normalized to the shared no-alert shape',async()=>{
 const receipt=valid();delete receipt.alert_id;
 const result=await invoke(receipt,{canonicalRequest:{intentDomain:'board'}});
 assert.deepEqual({...result},{...receipt,alert_id:null});
});
test('omitted alert identity is not accepted for action or alert-opened receipts',async()=>{
 const receipt=valid();delete receipt.alert_id;
 await assert.rejects(invoke(receipt),/receipt hợp lệ/);
 await assert.rejects(invoke({...receipt,execution_result:'alert_opened'},{canonicalRequest:{intentDomain:'board'}}),/receipt hợp lệ/);
});

const boardInput={tournamentId:'tour',tournamentTableId:'table',handId:'hand',voiceEventId:'root',idempotencyKey:'board:key',traceId:'board:trace',
 canonicalRequest:{intentDomain:'board',envelope:{expectedStateVersion:'a'.repeat(64)},payload:{street:'flop',newCards:['Ah','5s','2d'],cumulativeCards:['Ah','5s','2d'],expectedExistingBoardCount:0}}};
const validBoard=()=>({ok:true,voice_event_id:'root',canonical_receipt_event_id:'receipt',idempotency_key:'board:key',trace_id:'board:trace',
 street:'flop',previous_board:[],community_cards:['Ah','5s','2d'],state_version_before:'a'.repeat(64),state_version_after:'b'.repeat(64)});
async function invokeBoard(receipt,input=boardInput){
 let calls=0;const api=runInNewContext(boardCode,{Error,client:{functions:{invoke:async()=>{calls++;return {data:{data:receipt},error:null};}}}});
 try{return await api(input);}finally{assert.equal(calls,1,'no automatic mutation retry');}
}
test('canonical Board commit and duplicate original trace stay usable',async()=>{
 for(const receipt of [validBoard(),{...validBoard(),duplicate:true,trace_id:'original:trace'}])assert.equal(await invokeBoard(receipt),receipt);
});
test('turn and river preserve the confirmed board prefix',async()=>{
 for(const [street,previous,cards] of [['turn',['Ah','5s','2d'],['Ah','5s','2d','Tc']],['river',['Ah','5s','2d','Tc'],['Ah','5s','2d','Tc','Ks']]]){
  const input={...boardInput,canonicalRequest:{...boardInput.canonicalRequest,payload:{street,newCards:cards.slice(-1),cumulativeCards:cards,expectedExistingBoardCount:previous.length}}};
  const receipt={...validBoard(),street,previous_board:previous,community_cards:cards};
  assert.equal(await invokeBoard(receipt,input),receipt);
  await assert.rejects(invokeBoard({...receipt,previous_board:['Ac',...previous.slice(1)]},input),/receipt hợp lệ/);
 }
});
for(const [name,patch] of [
 ['truthy ok',{ok:'yes'}],['wrong root',{voice_event_id:'other'}],['missing receipt',{canonical_receipt_event_id:''}],
 ['wrong key',{idempotency_key:'other'}],['wrong trace',{trace_id:'other'}],['wrong before',{state_version_before:'c'.repeat(64)}],
 ['missing after',{state_version_after:undefined}],['unchanged proof',{state_version_after:'a'.repeat(64)}],
 ['wrong street',{street:'turn'}],['wrong cards',{community_cards:['Ah','5s','3d']}],['wrong previous',{previous_board:['Ac']}],
 ['duplicate marker string',{duplicate:'true'}],['duplicate wrong key',{duplicate:true,idempotency_key:'other'}],
])test(`reject unbound Board commit receipt: ${name}`,async()=>{
 await assert.rejects(invokeBoard({...validBoard(),...patch}),/Voice Board không trả canonical receipt hợp lệ/);
});

const holeInput={...boardInput,expectedStateVersion:'a'.repeat(64),canonicalRequest:{intentDomain:'hole_cards',envelope:{expectedStateVersion:'a'.repeat(64)},
 payload:{seatNumber:2,expectedPlayerId:'player',expectedEntryNumber:1,cards:['Kh','Ks']}}};
const validHole=()=>({ok:true,voice_event_id:'root',canonical_receipt_event_id:'receipt',idempotency_key:holeInput.idempotencyKey,trace_id:holeInput.traceId,
 seat_number:2,player_id:'player',entry_number:1,redacted:true,state_version_before:'a'.repeat(64),state_version_after:'b'.repeat(64)});
async function invokeHole(receipt){
 let calls=0;const api=runInNewContext(holeCode,{Error,client:{functions:{invoke:async()=>{calls++;return {data:{data:receipt},error:null};}}}});
 try{return await api(holeInput);}finally{assert.equal(calls,1);}
}
test('redacted hole receipt and original-trace duplicate remain usable',async()=>{
 for(const receipt of [validHole(),{...validHole(),duplicate:true,trace_id:'original'}])assert.equal(await invokeHole(receipt),receipt);
});
for(const [name,patch] of [
 ['truthy ok',{ok:'yes'}],['empty root',{voice_event_id:''}],['missing receipt',{canonical_receipt_event_id:undefined}],
 ['wrong key',{idempotency_key:'other'}],['wrong trace',{trace_id:'other'}],['wrong player',{player_id:'other'}],
 ['wrong entry',{entry_number:2}],['wrong seat',{seat_number:3}],['wrong before',{state_version_before:'c'.repeat(64)}],
 ['missing after',{state_version_after:undefined}],['unchanged proof',{state_version_after:'a'.repeat(64)}],
 ['duplicate marker string',{duplicate:'true'}],['duplicate wrong player',{duplicate:true,player_id:'other'}],
])test(`reject unbound hole receipt: ${name}`,async()=>{
 await assert.rejects(invokeHole({...validHole(),...patch}),/Voice bài tẩy không trả redacted canonical receipt hợp lệ/);
});

const finishInput={...boardInput,expectedStateVersion:'a'.repeat(64),canonicalRequest:{intentDomain:'finish_hand',envelope:{expectedStateVersion:'a'.repeat(64)},
 payload:{settlementOrigin:'engine_showdown',settlementDigest:'c'.repeat(64)}}};
const validFinish=()=>({ok:true,voice_event_id:'root',canonical_receipt_event_id:'receipt',idempotency_key:finishInput.idempotencyKey,trace_id:finishInput.traceId,
 hand_id:finishInput.handId,settlement_origin:'engine_showdown',settlement_digest:'c'.repeat(64),state_version_before:'a'.repeat(64),state_version_after:'b'.repeat(64)});
async function invokeFinish(receipt){
 let calls=0;const api=runInNewContext(finishCode,{Error,client:{functions:{invoke:async()=>{calls++;return {data:{data:receipt},error:null};}}}});
 try{return await api(finishInput);}finally{assert.equal(calls,1);}
}
test('Finish receipt and original-trace duplicate remain usable',async()=>{
 for(const receipt of [validFinish(),{...validFinish(),duplicate:true,trace_id:'original'}])assert.equal(await invokeFinish(receipt),receipt);
});
for(const [name,patch] of [
 ['truthy ok',{ok:'yes'}],['wrong hand',{hand_id:'other'}],['empty root',{voice_event_id:''}],['missing receipt',{canonical_receipt_event_id:''}],
 ['wrong key',{idempotency_key:'other'}],['wrong trace',{trace_id:'other'}],['wrong before',{state_version_before:'c'.repeat(64)}],
 ['missing after',{state_version_after:undefined}],['unchanged proof',{state_version_after:'a'.repeat(64)}],
 ['wrong origin',{settlement_origin:'engine_fold_win'}],['wrong digest',{settlement_digest:'d'.repeat(64)}],
 ['duplicate marker string',{duplicate:'true'}],['duplicate wrong hand',{duplicate:true,hand_id:'other'}],
])test(`reject unbound Finish receipt: ${name}`,async()=>{
 await assert.rejects(invokeFinish({...validFinish(),...patch}),/Voice Finish không trả canonical receipt hợp lệ/);
});
