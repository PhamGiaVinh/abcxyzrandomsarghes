import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';

// Actual loader body; Supabase RPC transport modeled. No Auth/DB permission proof.
const source=readFileSync(new URL('../../src/lib/trackerVoice/api.ts',import.meta.url),'utf8');
const tree=parseSync(source,{syntax:'typescript'});
const declaration=tree.body.find(node=>node.type==='ExportDeclaration'&&node.declaration.identifier?.value==='loadTrackerVoiceRuntimeContext')?.declaration;
assert.ok(declaration);
const text=Buffer.from(source).subarray(declaration.span.start-tree.span.start,declaration.span.end-tree.span.start).toString()
 .replace('const { supabase } = await import("@/integrations/supabase/client");','const supabase = client;');
assert.ok(!text.includes('await import('));
const code=transformSync(text+'\nloadTrackerVoiceRuntimeContext;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
const valid=()=>({ok:true,can_mint_session:true,read_only:false,correction_pending:false,tournament_table_id:'table',
 config:{enabled:true,configured_mode:'assist',provider_model:'existing-reviewed-model',spoken_amount_unit:1,amount_unit_confirmed:false,
  provider_confidence_threshold:null,server_auto_allowed:false,correction_state:'ready'},
 active_hand:{hand_id:'hand',hand_number:1,status:'in_progress',state_version:'a'.repeat(64)}});
function loader(data,error=null){
 const calls=[];const read=runInNewContext(code,{Error,client:{rpc:async(...args)=>{calls.push(args);return {data,error};}}});
 return {calls,read:()=>read('tour','table')};
}
test('valid enabled, disabled and no-active-hand runtime retain canonical values',async()=>{
 for(const data of [valid(),{...valid(),can_mint_session:false,read_only:true,active_hand:null,config:{...valid().config,enabled:false}},
  {...valid(),config:{...valid().config,spoken_amount_unit:1000,provider_confidence_threshold:0}},
  {...valid(),config:{...valid().config,provider_confidence_threshold:1}}]){
  const f=loader(data);assert.equal(await f.read(),data);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][0],'get_tracker_voice_runtime_context');
  assert.equal(f.calls[0][1].p_tournament_id,'tour');assert.equal(f.calls[0][1].p_tournament_table_id,'table');
 }
});
const cases=[
 ['truthy ok',{...valid(),ok:'yes'}],['missing config',{...valid(),config:null}],
 ['string authority',{...valid(),can_mint_session:'true'}],['missing read state',{...valid(),read_only:undefined}],
 ['unknown mode',{...valid(),config:{...valid().config,configured_mode:'unreviewed'}}],
 ['bad unit',{...valid(),config:{...valid().config,spoken_amount_unit:100}}],
 ['bad confidence',{...valid(),config:{...valid().config,provider_confidence_threshold:NaN}}],
 ['missing hand proof',{...valid(),active_hand:{...valid().active_hand,state_version:null}}],
 ['wrong table',{...valid(),tournament_table_id:'other'}],['missing active hand',{...valid(),active_hand:undefined}],
];
for(const [name,data] of cases)test(`reject malformed runtime: ${name}`,async()=>{
 await assert.rejects(loader(data).read(),name==='truthy ok'?/Không tải được quyền Voice/:/tracker_voice_runtime_malformed/);
});
test('preserves explicit server denial and network failure',async()=>{
 await assert.rejects(loader({ok:false,error:'dealer_assignment_missing'}).read(),/dealer_assignment_missing/);
 await assert.rejects(loader(valid(),{message:'Failed to fetch'}).read(),/Failed to fetch/);
});
