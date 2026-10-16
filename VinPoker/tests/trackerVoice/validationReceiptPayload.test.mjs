import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';
// Actual client API body with synthetic Edge transport, not authorization proof.
const source=readFileSync(new URL('../../src/lib/trackerVoice/api.ts',import.meta.url),'utf8');
const tree=parseSync(source,{syntax:'typescript'});
const fn=tree.body.find(n=>n.type==='ExportDeclaration'&&n.declaration.identifier?.value==='validateTrackerVoiceEvent')?.declaration;
assert.ok(fn);
const text=Buffer.from(source).subarray(fn.span.start-tree.span.start,fn.span.end-tree.span.start).toString()
 .replace('const { supabase } = await import("@/integrations/supabase/client");','const supabase = client;');
assert.ok(!text.includes('await import('));
const code=transformSync(text+'\nvalidateTrackerVoiceEvent;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
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
