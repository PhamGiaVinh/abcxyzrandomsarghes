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
function loader(data,error=null,tour='tour',table='table'){
 const calls=[];const read=runInNewContext(code,{Error,client:{rpc:async(...args)=>{calls.push(args);return {data,error};}}});
 return {calls,read:()=>read(tour,table)};
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

if(process.env.VINPOKER_NATIVE_VOICE_RUNTIME==='1')test('actual local authenticated runtime with Telegram-only Dealer passes loader; outsider denied',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {createPaidJourneyFixture}=await import('../cashier/paidJourney.fixture.mjs');
 const database='vinpoker_ops_cash115_qualified_c';
 for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
 const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']}).trim();
 const f=createPaidJourneyFixture(sql);
 const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t WHERE tournament_id='${f.tour}' AND status='active' ORDER BY id LIMIT 1;`));
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}'),
 'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE tournament_id='${f.tour}'),
 'config',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tracker_voice_configs c WHERE tournament_id='${f.tour}'),
 'global',(SELECT to_jsonb(a) FROM public.app_settings a WHERE key='tracker_voice_global_enabled'),
 'dealers',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d WHERE club_id='${f.club}'),
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${f.club}'),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.table_operation_receipts r))::text);`);
 const before=fingerprint();
 // Canonical paid/open flow above; assignment/config below are explicit local
 // control-plane fixtures inside rollback, NOT dealer check-in/rotation proof.
 const payload=JSON.parse(sql(`BEGIN;
 CREATE TEMP TABLE native_voice_payloads(k text,v jsonb);GRANT SELECT,INSERT ON native_voice_payloads TO authenticated;
 SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';
 DO $$ DECLARE r jsonb;s record;d uuid:=gen_random_uuid();a uuid:=gen_random_uuid();BEGIN
 SELECT * INTO STRICT s FROM public.table_sessions WHERE id='${table.table_session_id}';
 r:=public.floor_request_table_control_mode_v4('${table.id}',s.id,'tracker',s.revision,s.control_epoch,gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_mode_failed: %',r;END IF;
 INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(d,'${f.club}',NULL,'Native Voice Telegram TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,current_state,status) VALUES(a,d,'assigned','checked_in');
 INSERT INTO public.dealer_assignments(dealer_id,attendance_id,table_id,table_session_id,club_id,assigned_at,status)
 VALUES(d,a,'${table.game_table_id}',s.id,'${f.club}',now(),'assigned');
 INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,control_epoch,enabled)
 SELECT '${f.club}','${f.tour}','${table.id}','${table.game_table_id}',id,control_epoch,true FROM public.table_sessions WHERE id=s.id
 ON CONFLICT(tournament_id,tournament_table_id) DO UPDATE SET enabled=true,table_session_id=excluded.table_session_id,control_epoch=excluded.control_epoch;
 END $$;
 SET LOCAL ROLE authenticated;
 INSERT INTO native_voice_payloads VALUES('owner',public.get_tracker_voice_runtime_context('${f.tour}','${table.id}'));
 SET LOCAL request.jwt.claim.sub='${f.player}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.player}"}';
 INSERT INTO native_voice_payloads VALUES('outsider',public.get_tracker_voice_runtime_context('${f.tour}','${table.id}'));
 RESET ROLE;
 SELECT jsonb_object_agg(k,v) FROM native_voice_payloads;
 ROLLBACK;`));
 assert.equal(payload.owner.ok,true);assert.equal(payload.owner.active_hand,null);assert.equal(payload.owner.can_mint_session,true);
 assert.equal(await loader(payload.owner,null,f.tour,table.id).read(),payload.owner);
 assert.equal(payload.outsider.ok,false);assert.equal(payload.outsider.error,'dealer_assignment_missing');
 await assert.rejects(loader(payload.outsider,null,f.tour,table.id).read(),/dealer_assignment_missing/);
 assert.equal(fingerprint(),before);
 assert.equal(sql(`SELECT count(*) FROM public.dealers WHERE club_id='${f.club}' AND full_name='Native Voice Telegram TEST';`),'0');
 console.log('NATIVE_VOICE_SQL_PAYLOAD_OWNER_TELEGRAM_NOHAND_ROLLBACK_PASS');
});
