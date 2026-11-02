import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';
import {routeTrackerVoiceIntent} from '../../src/lib/trackerVoice/intentRouter.ts';
import {buildVoiceBoardCanonicalRequest,actionWorkflowForStreet} from '../../src/lib/trackerVoice/canonicalRequest.ts';

// Actual loader body; Supabase RPC transport modeled. No Auth/DB permission proof.
const source=readFileSync(new URL('../../src/lib/trackerVoice/api.ts',import.meta.url),'utf8');
const tree=parseSync(source,{syntax:'typescript'});
function compileApi(name){
const declaration=tree.body.find(node=>node.type==='ExportDeclaration'&&node.declaration.identifier?.value===name)?.declaration;
assert.ok(declaration);
const text=Buffer.from(source).subarray(declaration.span.start-tree.span.start,declaration.span.end-tree.span.start).toString()
 .replace('const { supabase } = await import("@/integrations/supabase/client");','const supabase = client;');
assert.ok(!text.includes('await import('));
return transformSync(text+'\n'+name+';',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
}
const code=compileApi('loadTrackerVoiceRuntimeContext'),validationCode=compileApi('validateTrackerVoiceEvent'),boardCommitCode=compileApi('commitTrackerVoiceBoard'),holeCommitCode=compileApi('commitTrackerVoiceHoleCards');
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

if(process.env.VINPOKER_NATIVE_VOICE_RUNTIME==='1')test('paid active-hand Voice authority, canonical manual handoff and stale receipt fences',async()=>{
 const {execFileSync}=await import('node:child_process');
 const {createPaidJourneyFixture}=await import('../cashier/paidJourney.fixture.mjs');
 const database='vinpoker_ops_cash115_qualified_c';
 for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
 const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
 const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']}).trim();
 const f=createPaidJourneyFixture(sql);
 const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t JOIN public.tournament_seats seat ON seat.tournament_table_id=t.id WHERE seat.entry_id='${f.entry}' AND seat.is_active;`));
 const floorActor=crypto.randomUUID();
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}'),
 'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournament_tables t WHERE tournament_id='${f.tour}'),
 'config',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tracker_voice_configs c WHERE tournament_id='${f.tour}'),
 'global',(SELECT to_jsonb(a) FROM public.app_settings a WHERE key='tracker_voice_global_enabled'),
 'dealers',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d WHERE club_id='${f.club}'),
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE club_id='${f.club}'),
 'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE d.club_id='${f.club}'),
 'floors',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.club_floors r WHERE club_id='${f.club}'),
 'tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r WHERE tournament_id='${f.tour}'),
 'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id='${f.tour}'),
 'cash',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_seats r WHERE tournament_id='${f.tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_hands r WHERE tournament_id='${f.tour}'),
 'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id WHERE h.tournament_id='${f.tour}'),
 'voice_events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tracker_voice_events e WHERE tournament_id='${f.tour}'),
 'shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_shifts s WHERE club_id='${f.club}'),
 'swing_requests',(SELECT jsonb_agg(to_jsonb(s) ORDER BY request_id) FROM public.dealer_swing_operator_requests s WHERE club_id='${f.club}'),
 'rotation',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_rotation_schedule s WHERE club_id='${f.club}'),
 'auto',(SELECT to_jsonb(s) FROM public.club_settings s WHERE club_id='${f.club}'),
 'notification_sink_count',(SELECT count(*) FROM net.cash_ui_http_sink),
 'chip_sets',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.chip_set s WHERE club_id='${f.club}'),
 'chip_denoms',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.chip_set_denomination s WHERE club_id='${f.club}'),
 'tour_chip_set',(SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.tournament_chip_set s WHERE tournament_id='${f.tour}'),
 'stack_templates',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.stack_template s WHERE tournament_id='${f.tour}'),
 'issuance',(SELECT jsonb_agg(to_jsonb(s) ORDER BY stack_template_id) FROM public.stack_template_issuance s WHERE club_id='${f.club}'),
 'chip_bank',(SELECT jsonb_agg(to_jsonb(s) ORDER BY denomination_id) FROM public.chip_bank s WHERE club_id='${f.club}'),
 'chip_bank_ledger',(SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.chip_bank_ledger s WHERE club_id='${f.club}'),
 'chip_floor_ledger',(SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.chip_inventory_ledger s WHERE club_id='${f.club}'),
 'colorup',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.color_up_operation s WHERE club_id='${f.club}'),
 'chip_receipts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY request_key) FROM floor_private.chip_mutation_receipts s WHERE actor_id='${f.actor}'),
 'tv_displays',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tv_displays s WHERE club_id='${f.club}'),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.table_operation_receipts r))::text);`);
 const before=fingerprint();
 const boardTranscript='flop ace hearts five spades two diamonds';
 const boardRoute=routeTrackerVoiceIntent(boardTranscript,'enter_flop');
 assert.equal(boardRoute.ok,true);assert.equal(boardRoute.intentDomain,'board');
 assert.equal(routeTrackerVoiceIntent(boardTranscript,'preflop_action').code,'wrong_workflow');
 assert.equal(routeTrackerVoiceIntent('flop ace hearts ace hearts two diamonds','enter_flop').ok,false);
 const boardCanonical=await buildVoiceBoardCanonicalRequest({rawTranscript:boardTranscript,expectedStateVersion:'0'.repeat(64),
  expectedWorkflowState:'enter_flop',expectedStreet:boardRoute.command.street,
  payload:{street:boardRoute.command.street,newCards:boardRoute.command.newCards,cumulativeCards:boardRoute.command.newCards,expectedExistingBoardCount:0}});
 const boardCanonicalSql=JSON.stringify(boardCanonical).replaceAll("'","''");
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
 INSERT INTO public.tracker_voice_configs(club_id,tournament_id,tournament_table_id,physical_table_id,table_session_id,control_epoch,enabled,configured_mode)
 SELECT '${f.club}','${f.tour}','${table.id}','${table.game_table_id}',id,control_epoch,true,'assist' FROM public.table_sessions WHERE id=s.id
 ON CONFLICT(tournament_id,tournament_table_id) DO UPDATE SET enabled=true,configured_mode='assist',table_session_id=excluded.table_session_id,control_epoch=excluded.control_epoch;
 END $$;
 SET LOCAL ROLE authenticated;
 INSERT INTO native_voice_payloads VALUES('owner',public.get_tracker_voice_runtime_context('${f.tour}','${table.id}'));
 RESET ROLE;
 DO $$ DECLARE r jsonb;other record;player uuid:=gen_random_uuid();reg uuid;s record;button integer;BEGIN
 SELECT t.id,ts.revision INTO STRICT other FROM public.tournament_tables t JOIN public.table_sessions ts ON ts.id=t.table_session_id
 WHERE t.tournament_id='${f.tour}' AND t.id<>'${table.id}' AND t.status='active';
 PERFORM set_config('role','authenticated',true);
 r:=public.close_tournament_table_v4(other.id,other.revision,gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_empty_close_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 INSERT INTO auth.users(id) VALUES(player),('${floorActor}');
 INSERT INTO public.club_floors(club_id,user_id) VALUES('${f.club}','${floorActor}');
 PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1('${f.tour}',player);reg:=(r->>'registration_id')::uuid;
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_registration_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}','tournament_id','${f.tour}','registration_id',reg,'amount',100000,'request_id',gen_random_uuid()),'record');
 IF r->>'status'<>'recorded' OR r->'result'->>'seating_state'<>'seated' THEN RAISE EXCEPTION 'native_voice_paid_seating_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT * INTO STRICT s FROM public.table_sessions WHERE id='${table.table_session_id}';
 SELECT min(seat_number) INTO button FROM public.tournament_seats WHERE table_session_id=s.id AND is_active;
 PERFORM set_config('role','authenticated',true);
 r:=public.floor_start_tournament_clock('${f.tour}');IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_clock_failed: %',r;END IF;
 r:=public.start_tracker_hand_v3('${f.tour}','${table.id}',s.id,s.control_epoch,1,now(),'${f.actor}',button);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_voice_hand_start_failed: %',r;END IF;
 END $$;
 INSERT INTO native_voice_payloads VALUES('owner_active',public.get_tracker_voice_runtime_context('${f.tour}','${table.id}'));
 SET LOCAL request.jwt.claim.sub='${floorActor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${floorActor}"}';
 INSERT INTO native_voice_payloads VALUES('floor_active',public.get_tracker_voice_runtime_context('${f.tour}','${table.id}'));
 SET LOCAL request.jwt.claim.sub='${f.player}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.player}"}';
 INSERT INTO native_voice_payloads VALUES('outsider',public.get_tracker_voice_runtime_context('${f.tour}','${table.id}'));
 RESET ROLE;
 INSERT INTO native_voice_payloads SELECT 'hand_proof',jsonb_build_object('hand_id',h.id,'state_version',public._tracker_voice_hand_state_version(h.id),
 'players',(SELECT count(*) FROM public.hand_players p WHERE p.hand_id=h.id),'starting_stack',(SELECT sum(starting_stack) FROM public.hand_players p WHERE p.hand_id=h.id))
 FROM public.tournament_hands h WHERE tournament_id='${f.tour}' AND status='in_progress';
 DO $$ DECLARE chip_set uuid:=gen_random_uuid();low uuid:=gen_random_uuid();high uuid:=gen_random_uuid();template uuid:=gen_random_uuid();
 issued jsonb;op jsonb;r jsonb;key text:='native-paid-color-'||gen_random_uuid()::text;operational jsonb;
 tv_token text:='native-paid-chip-tv-'||gen_random_uuid()::text;tv_before jsonb;tv_after jsonb;tv_undo jsonb;tv_payload jsonb;BEGIN
 -- Setup metadata fixture only; issuance/color-up/undo use actual Chip RPCs.
 SELECT jsonb_build_object('seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id WHERE h.tournament_id='${f.tour}')) INTO operational;
 INSERT INTO public.chip_set(id,club_id,name) VALUES(chip_set,'${f.club}','Native paid chip TEST');
 INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES(low,chip_set,'${f.club}',100),(high,chip_set,'${f.club}',1000);
 INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id) VALUES('${f.tour}',chip_set,'${f.club}');
 INSERT INTO public.stack_template(id,tournament_id,club_id,chip_set_id,name,stack_value) VALUES(template,'${f.tour}','${f.club}',chip_set,'Native paid stack TEST',20000);
 INSERT INTO public.stack_template_line(stack_template_id,denomination_id,count) VALUES(template,low,200);
 INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES('${f.club}',low,1000),('${f.club}',high,100);
 -- Explicit local display pairing, not pairing UI or hosted anonymous HTTP.
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status) VALUES(gen_random_uuid(),'${f.club}',tv_token,'${f.tour}','paired');
 PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.chip_ops_set_bank_coupling('${f.club}',true);IF r->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'native_paid_chip_coupling_failed: %',r;END IF;
 issued:=public.chip_ops_set_issuance_v2(template,2,0,gen_random_uuid(),'${f.actor}');
 IF issued->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'native_paid_chip_issue_failed: %',issued;END IF;
 IF (SELECT sum(current_count*value) FROM public.chip_ops_current_denom_counts('${f.tour}')) IS DISTINCT FROM 40000::numeric THEN RAISE EXCEPTION 'native_paid_chip_issue_value_mismatch';END IF;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);PERFORM set_config('role','anon',true);
 tv_before:=public.get_tv_display_state_v4(tv_token,true);
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 op:=public.chip_ops_color_up('${f.tour}',low,high,40,1,key);
 IF op->>'status' IS DISTINCT FROM 'ok' OR (op->>'rounding_delta')::bigint<>0 THEN RAISE EXCEPTION 'native_paid_colorup_failed: %',op;END IF;
 IF public.chip_ops_color_up('${f.tour}',low,high,40,1,key) IS DISTINCT FROM op THEN RAISE EXCEPTION 'native_paid_colorup_replay_changed';END IF;
 IF (SELECT sum(current_count*value) FROM public.chip_ops_current_denom_counts('${f.tour}')) IS DISTINCT FROM 40000::numeric THEN RAISE EXCEPTION 'native_paid_colorup_value_changed';END IF;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);PERFORM set_config('role','anon',true);
 tv_after:=public.get_tv_display_state_v4(tv_token,true);
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.chip_ops_reverse_color_up((op->>'color_up_operation_id')::uuid,key||'-undo');
 IF r->>'status' IS DISTINCT FROM 'ok' OR (r->>'bank_reversed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'native_paid_colorup_undo_failed: %',r;END IF;
 IF (SELECT current_count FROM public.chip_ops_current_denom_counts('${f.tour}') WHERE denomination_id=low) IS DISTINCT FROM 400::bigint
 OR (SELECT current_count FROM public.chip_ops_current_denom_counts('${f.tour}') WHERE denomination_id=high) IS DISTINCT FROM 0::bigint
 OR (SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id=low) IS DISTINCT FROM 600::bigint
 OR (SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id=high) IS DISTINCT FROM 100::bigint
 OR (public.get_current_chip_inventory('${f.tour}')->>'reconciled')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'native_paid_colorup_undo_not_reconciled';END IF;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);PERFORM set_config('role','anon',true);
 tv_undo:=public.get_tv_display_state_v4(tv_token,true);
 PERFORM set_config('role','none',true);
 FOREACH tv_payload IN ARRAY ARRAY[tv_before,tv_after,tv_undo] LOOP
 IF tv_payload->>'status' IS DISTINCT FROM 'paired' OR tv_payload->'tournament'->>'id' IS DISTINCT FROM '${f.tour}'
 OR tv_payload->'clock'->>'tournament_id' IS DISTINCT FROM '${f.tour}'
 OR (tv_payload->'participation_counts'->>'remaining')::integer IS DISTINCT FROM 2
 OR (tv_payload->'participation_counts'->>'live_entry_stack')::bigint IS DISTINCT FROM 40000::bigint THEN RAISE EXCEPTION 'native_paid_colorup_tv_scope_or_stack_changed: %',tv_payload;END IF;
 END LOOP;
 IF (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active)<>40000
 OR operational IS DISTINCT FROM (SELECT jsonb_build_object('seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'cash',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id WHERE h.tournament_id='${f.tour}'))) THEN RAISE EXCEPTION 'native_paid_chip_ops_changed_cash_seats_or_roster';END IF;
 INSERT INTO native_voice_payloads VALUES('paid_chips',jsonb_build_object('issued',issued,'color_up',op,'undo',r,'tv_after',tv_after));
 END $$;
 DO $$ DECLARE h record;p record;p2 record;state text;command jsonb;receipt jsonb;replay jsonb;r jsonb;action_state jsonb;assignment_denial jsonb;handoff_denial jsonb;board_receipt jsonb;board_snapshot jsonb;board_commit jsonb;board_revision bigint;hole_payload jsonb;hole_snapshot jsonb;hole_commit jsonb;
 incoming_dealer uuid:=gen_random_uuid();incoming_attendance uuid;incoming_shift uuid:=gen_random_uuid();outgoing record;
 checkin_key uuid:=gen_random_uuid();checkin_receipt jsonb;
 k text:='native-voice-'||gen_random_uuid()::text;BEGIN
 SELECT * INTO STRICT h FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress';
 SELECT * INTO STRICT p FROM public.hand_players WHERE hand_id=h.id ORDER BY seat_number LIMIT 1;
 state:=public._tracker_voice_hand_state_version(h.id);
 BEGIN
 SELECT * INTO STRICT p2 FROM public.hand_players WHERE hand_id=h.id AND player_id<>p.player_id;
 PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.record_action(h.id,p.player_id,'post_sb',1,p.entry_number,'preflop',100);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_board_sb_failed: %',r;END IF;
 r:=public.record_action(h.id,p2.player_id,'post_bb',2,p2.entry_number,'preflop',200);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_board_bb_failed: %',r;END IF;
 r:=public.record_action(h.id,p.player_id,'call',3,p.entry_number,'preflop',100);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_board_call_failed: %',r;END IF;
 r:=public.record_action(h.id,p2.player_id,'check',4,p2.entry_number,'preflop',0);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_board_check_failed: %',r;END IF;
 board_snapshot:=public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}',h.id);
 IF board_snapshot->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_board_snapshot_failed: %',board_snapshot;END IF;
 PERFORM set_config('role','none',true);
 SELECT source_revision INTO board_revision FROM public.tournament_hands WHERE id=h.id;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 command:=jsonb_set('${boardCanonicalSql}'::jsonb,'{envelope,expectedStateVersion}',to_jsonb(board_snapshot->>'state_version'));
 receipt:=public._tracker_voice_register_validated_board_event('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-positive-board','${boardTranscript}',
 jsonb_build_object('kind','board','intent_domain','board','canonical_request',command),
 board_snapshot->>'state_version','assist',k||'-positive-board','native-positive-board');
 IF receipt->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_board_positive_root_failed: %',receipt;END IF;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 board_commit:=public.commit_tracker_voice_board_v0((receipt->>'voice_event_id')::uuid,k||'-positive-board','native-positive-commit');
 IF board_commit->>'ok' IS DISTINCT FROM 'true' OR board_commit->'community_cards' IS DISTINCT FROM '["Ah","5s","2d"]'::jsonb THEN RAISE EXCEPTION 'native_board_positive_commit_failed: %',board_commit;END IF;
 replay:=public.commit_tracker_voice_board_v0((receipt->>'voice_event_id')::uuid,k||'-positive-board','native-positive-retry');
 IF replay IS DISTINCT FROM board_commit||jsonb_build_object('duplicate',true) THEN RAISE EXCEPTION 'native_board_positive_replay_failed: %',replay;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT source_revision FROM public.tournament_hands WHERE id=h.id)<=board_revision OR public._tracker_voice_hand_state_version(h.id)=board_snapshot->>'state_version'
 OR (SELECT community_cards FROM public.tournament_hands WHERE id=h.id) IS DISTINCT FROM '["Ah","5s","2d"]'::jsonb
 OR (SELECT count(*) FROM public.tracker_voice_events WHERE root_event_id=(board_commit->>'voice_event_id')::uuid AND event_kind='canonical_receipt')<>1 THEN RAISE EXCEPTION 'native_board_positive_revision_or_receipt_failed';END IF;
 PERFORM set_config('role','authenticated',true);
 r:=public.record_action(h.id,p2.player_id,'all_in',5,p2.entry_number,'flop',19800);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_hole_allin_failed: %',r;END IF;
 r:=public.record_action(h.id,p.player_id,'all_in',6,p.entry_number,'flop',19800);
 IF r->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'native_hole_match_failed: %',r;END IF;
 hole_snapshot:=public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}',h.id);
 IF hole_snapshot->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_hole_snapshot_failed: %',hole_snapshot;END IF;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 hole_commit:=public.commit_tracker_voice_hole_cards_v0('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-hole',hole_snapshot->>'state_version',k||'-hole','native-hole-trace',p.seat_number,'["Kh","Ks"]'::jsonb);
 IF hole_commit->>'ok' IS DISTINCT FROM 'true' OR hole_commit->>'redacted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_hole_commit_failed: %',hole_commit;END IF;
 hole_payload:=jsonb_build_object('snapshot',hole_snapshot,'receipt',hole_commit,'request_identity',jsonb_build_object(
 'idempotencyKey',k||'-hole','traceId','native-hole-trace','expectedStateVersion',hole_snapshot->>'state_version',
 'playerId',p.player_id,'entryNumber',p.entry_number,'seatNumber',p.seat_number));
 PERFORM set_config('role','none',true);
 IF (SELECT hole_cards FROM public.hand_players WHERE hand_id=h.id AND player_id=p.player_id) IS DISTINCT FROM '["Kh","Ks"]'::jsonb THEN RAISE EXCEPTION 'native_hole_cards_not_persisted';END IF;
 RAISE SQLSTATE 'PZ004' USING MESSAGE='native_board_positive_case_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ004' THEN NULL;
 END;
 INSERT INTO native_voice_payloads VALUES('board_workflow',jsonb_build_object('snapshot',board_snapshot,'commit',board_commit,'canonical_request',command,
 'commit_request',jsonb_build_object('voiceEventId',receipt->>'voice_event_id','idempotencyKey',k||'-positive-board','traceId','native-positive-commit')));
 INSERT INTO native_voice_payloads VALUES('hole_workflow',hole_payload);
 -- Qualify only the trusted service root receipt shape, not Board workflow legality or Edge parsing.
 BEGIN
 PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 board_receipt:=public._tracker_voice_register_validated_board_event('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-board','Flop ace hearts five spades two diamonds',
 jsonb_build_object('kind','board','intent_domain','board','canonical_request',jsonb_build_object('intentDomain','board')),
 state,'assist',k||'-board','native-board-trace');
 IF board_receipt->>'ok' IS DISTINCT FROM 'true' OR board_receipt ? 'alert_id' THEN RAISE EXCEPTION 'native_board_receipt_shape: %',board_receipt;END IF;
 command:=jsonb_build_object('kind','board','intent_domain','board','canonical_request',jsonb_build_object('intentDomain','board'));
 replay:=public._tracker_voice_register_validated_board_event('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-board','Flop ace hearts five spades two diamonds',command,state,'assist',k||'-board','native-board-retry');
 IF replay IS DISTINCT FROM board_receipt||jsonb_build_object('duplicate',true) THEN RAISE EXCEPTION 'native_board_replay_changed_receipt: %',replay;END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('hand',to_jsonb(row),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE e.hand_id=h.id)) INTO action_state FROM public.tournament_hands row WHERE id=h.id;
 PERFORM set_config('role','service_role',true);
 replay:=public._tracker_voice_register_validated_board_event('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-board','Different transcript',command,state,'assist',k||'-board','native-board-conflict');
 IF replay->>'error' IS DISTINCT FROM 'idempotency_mismatch' THEN RAISE EXCEPTION 'native_board_conflict_accepted: %',replay;END IF;
 replay:=public._tracker_voice_register_validated_board_event('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-board-stale','Flop ace hearts five spades two diamonds',command,
 CASE WHEN state=repeat('a',64) THEN repeat('b',64) ELSE repeat('a',64) END,'assist',k||'-board-stale','native-board-stale');
 IF replay->>'error' IS DISTINCT FROM 'stale_state_version' THEN RAISE EXCEPTION 'native_board_stale_accepted: %',replay;END IF;
 replay:=public._tracker_voice_register_validated_board_event(gen_random_uuid(),'${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-board-outsider','Flop ace hearts five spades two diamonds',command,state,'assist',k||'-board-outsider','native-board-outsider');
 IF replay->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'native_board_outsider_accepted: %',replay;END IF;
 PERFORM set_config('role','none',true);
 IF action_state IS DISTINCT FROM (SELECT jsonb_build_object('hand',to_jsonb(row),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE e.hand_id=h.id)) FROM public.tournament_hands row WHERE id=h.id)
 THEN RAISE EXCEPTION 'native_board_denial_changed_hand_or_events';END IF;
 RAISE SQLSTATE 'PZ003' USING MESSAGE='native_board_root_receipt_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ003' THEN NULL;
 END;
 INSERT INTO native_voice_payloads VALUES('voice_board',jsonb_build_object('receipt',board_receipt,
 'request_identity',jsonb_build_object('idempotencyKey',k||'-board','traceId','native-board-trace','expectedStateVersion',state,'executionMode','assist','providerEventId',k||'-board')));
 -- Trusted service-normalized fixture, NOT Edge parser/engine/provider proof.
 command:=jsonb_build_object('kind','check','canonical_action','check','actor_player_id',p.player_id,'entry_number',p.entry_number,'street','preflop','action_order',1,'action_amount',0);
 PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 receipt:=public._tracker_voice_register_validated_event('${f.actor}','${f.tour}','${table.id}',h.id,'openai_realtime','gpt-live-transcribe',k,NULL,'check',command,state,'assist',k,'native-voice-trace','enforce',true,NULL);
 IF receipt->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_event_registration_failed: %',receipt;END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('hand',to_jsonb(row),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE e.hand_id=h.id)) INTO action_state FROM public.tournament_hands row WHERE id=h.id;
 -- Controlled assignment-revocation fixture, not a replacement/acquisition:
 -- Auto stays OFF and its acquisition guard must not be bypassed.
 -- Roll back this subcase before the positive write; not a Swing/rest test.
 BEGIN
 UPDATE public.dealer_assignments SET status='completed',released_at=now() WHERE table_session_id=h.table_session_id AND status='assigned' AND released_at IS NULL;
 PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.get_tracker_voice_runtime_context('${f.tour}','${table.id}');
 IF r->>'error' IS DISTINCT FROM 'dealer_assignment_missing' THEN RAISE EXCEPTION 'native_voice_revocation_runtime_not_denied: %',r;END IF;
 assignment_denial:=public.record_action(h.id,p.player_id,'check',1,p.entry_number,'preflop',0,k,'native-after-revocation','${f.actor}');
 IF assignment_denial->>'error' IS DISTINCT FROM 'dealer_assignment_lost' THEN RAISE EXCEPTION 'native_voice_old_assignment_receipt_accepted: %',assignment_denial;END IF;
 PERFORM set_config('role','none',true);
 IF action_state IS DISTINCT FROM (SELECT jsonb_build_object('hand',to_jsonb(row),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE e.hand_id=h.id)) FROM public.tournament_hands row WHERE id=h.id) THEN RAISE EXCEPTION 'native_voice_revocation_denial_changed_source';END IF;
 RAISE SQLSTATE 'PZ001' USING MESSAGE='native_voice_revocation_case_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 -- A separate canonical manual handoff, with a fresh never-assigned dealer.
 -- No Auto toggle, rest timestamp rewrite, force-OT or manual intent header.
 BEGIN
 -- Trusted service Board proposal made before the canonical dealer handoff.
 -- This probes assignment fencing, not Edge workflow/grammar acceptance.
 PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 board_receipt:=public._tracker_voice_register_validated_board_event('${f.actor}','${f.tour}','${table.id}',h.id,
 'openai_realtime','gpt-live-transcribe',k||'-handoff-board','Flop ace hearts five spades two diamonds',
 jsonb_build_object('kind','board','intent_domain','board','canonical_request',jsonb_build_object('intentDomain','board',
 'payload',jsonb_build_object('street','flop','cumulativeCards',jsonb_build_array('Ah','5s','2d'),'expectedExistingBoardCount',0))),
 state,'assist',k||'-handoff-board','native-handoff-board');
 IF board_receipt->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_board_handoff_root_failed: %',board_receipt;END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('hand',to_jsonb(row),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE e.hand_id=h.id)) INTO action_state FROM public.tournament_hands row WHERE id=h.id;
 IF EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='${f.club}' AND auto_swing_enabled) THEN RAISE EXCEPTION 'native_voice_handoff_requires_auto_off';END IF;
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES(incoming_shift,'${f.club}','Native handoff TEST','00:00','23:59');
 INSERT INTO public.dealers(id,club_id,user_id,full_name,status) VALUES(incoming_dealer,'${f.club}',NULL,'Native standby TEST','active');
 SELECT * INTO STRICT outgoing FROM public.dealer_assignments WHERE table_session_id=h.table_session_id AND status='assigned' AND released_at IS NULL;
 PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub','${f.player}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.player}"}',true);
 r:=public.operator_check_in_dealer_v1(incoming_dealer,'${f.club}',incoming_shift,checkin_key);
 IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'native_voice_checkin_outsider_accepted: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.dealer_attendance WHERE dealer_id=incoming_dealer) THEN RAISE EXCEPTION 'native_voice_checkin_outsider_created_attendance';END IF;
 PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 checkin_receipt:=public.operator_check_in_dealer_v1(incoming_dealer,'${f.club}',incoming_shift,checkin_key);
 IF checkin_receipt->>'ok' IS DISTINCT FROM 'true' OR checkin_receipt->>'outcome' IS DISTINCT FROM 'checked_in' THEN RAISE EXCEPTION 'native_voice_standby_checkin_failed: %',checkin_receipt;END IF;
 incoming_attendance:=(checkin_receipt->>'attendance_id')::uuid;
 IF public.operator_check_in_dealer_v1(incoming_dealer,'${f.club}',incoming_shift,checkin_key) IS DISTINCT FROM checkin_receipt THEN RAISE EXCEPTION 'native_voice_checkin_replay_changed_receipt';END IF;
 r:=public.get_dealer_checkin_receipt_v1(incoming_dealer,'${f.club}',incoming_shift,checkin_key);
 IF r->>'status' IS DISTINCT FROM 'committed' OR r->'result' IS DISTINCT FROM checkin_receipt THEN RAISE EXCEPTION 'native_voice_checkin_readback_failed: %',r;END IF;
 r:=public.operator_check_in_dealer_v1(incoming_dealer,'${f.club}',gen_random_uuid(),checkin_key);
 IF r->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'native_voice_checkin_payload_conflict_missing: %',r;END IF;
 r:=public.operator_check_in_dealer_v1(incoming_dealer,'${f.club}',incoming_shift,gen_random_uuid());
 IF r->>'outcome' IS DISTINCT FROM 'already_checked_in' OR (r->>'attendance_id')::uuid IS DISTINCT FROM incoming_attendance THEN RAISE EXCEPTION 'native_voice_checkin_second_request_duplicated: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.dealer_attendance WHERE dealer_id=incoming_dealer)<>1
 OR NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id=incoming_attendance AND current_state='available' AND status='checked_in'
  AND shift_date=(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND check_in_time IS NOT NULL AND last_released_at IS NULL) THEN RAISE EXCEPTION 'native_voice_checkin_server_day_or_single_attendance_failed';END IF;
 PERFORM set_config('role','authenticated',true);
 r:=public.operator_plan_next_dealer_v1(h.table_session_id,outgoing.id,outgoing.version,incoming_attendance,gen_random_uuid());
 IF r->>'outcome' NOT IN ('changed','noop_same_dealer') OR r->>'outcome' IS NULL THEN RAISE EXCEPTION 'native_voice_manual_next_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT * INTO STRICT outgoing FROM public.dealer_assignments WHERE id=outgoing.id;
 PERFORM set_config('role','authenticated',true);
 r:=public.operator_perform_swing_v2('${f.actor}','${f.club}','${table.game_table_id}',h.table_session_id,outgoing.id,outgoing.version,gen_random_uuid());
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id=h.table_session_id AND status='assigned' AND released_at IS NULL)<>1
 OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id=h.table_session_id AND dealer_id=incoming_dealer AND status='assigned' AND released_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=outgoing.id AND released_at IS NOT NULL) THEN RAISE EXCEPTION 'native_voice_manual_handoff_not_committed: %',r;END IF;
 PERFORM set_config('role','authenticated',true);
 r:=public.get_tracker_voice_runtime_context('${f.tour}','${table.id}');IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_after_handoff_runtime_invalid: %',r;END IF;
 handoff_denial:=public.record_action(h.id,p.player_id,'check',1,p.entry_number,'preflop',0,k,'native-real-manual-handoff','${f.actor}');
 IF handoff_denial->>'error' IS DISTINCT FROM 'dealer_assignment_lost' THEN RAISE EXCEPTION 'native_voice_handoff_old_receipt_accepted: %',handoff_denial;END IF;
 r:=public.commit_tracker_voice_board_v0((board_receipt->>'voice_event_id')::uuid,k||'-handoff-board','native-handoff-board-commit');
 IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'error' IS DISTINCT FROM 'voice_assignment_changed' THEN RAISE EXCEPTION 'native_board_handoff_old_receipt_accepted: %',r;END IF;
 PERFORM set_config('role','none',true);
 IF action_state IS DISTINCT FROM (SELECT jsonb_build_object('hand',to_jsonb(row),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE e.hand_id=h.id)) FROM public.tournament_hands row WHERE id=h.id) THEN RAISE EXCEPTION 'native_voice_handoff_denial_changed_source';END IF;
 IF EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='${f.club}' AND auto_swing_enabled) THEN RAISE EXCEPTION 'native_voice_handoff_enabled_auto';END IF;
 RAISE SQLSTATE 'PZ002' USING MESSAGE='native_voice_manual_handoff_case_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
 END;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.record_action(h.id,p.player_id,'check',1,p.entry_number,'preflop',0,k,'native-voice-trace','${f.actor}');
 IF r->>'status' IS DISTINCT FROM 'success' OR r->>'source' IS DISTINCT FROM 'voice' THEN RAISE EXCEPTION 'native_voice_canonical_action_failed: %',r;END IF;
 PERFORM set_config('role','none',true);
 SELECT jsonb_build_object('hand',to_jsonb(row),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id)) INTO action_state FROM public.tournament_hands row WHERE id=h.id;
 PERFORM set_config('role','authenticated',true);
 replay:=public.record_action(h.id,p.player_id,'check',1,p.entry_number,'preflop',0,k,'native-voice-retry','${f.actor}');
 IF replay->>'status' IS DISTINCT FROM 'success' OR replay->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native_voice_action_replay_failed: %',replay;END IF;
 replay:=public.record_action(h.id,p.player_id,'check',1,p.entry_number,'preflop',1,k,'native-voice-conflict','${f.actor}');
 IF replay->>'error' IS DISTINCT FROM 'idempotency_key_conflict' THEN RAISE EXCEPTION 'native_voice_payload_conflict_missing: %',replay;END IF;
 replay:=public.record_action(h.id,p.player_id,'check',2,p.entry_number,'preflop',0,k||'-spoof','native-voice-spoof','${f.player}');
 IF replay->>'error' IS DISTINCT FROM 'actor_mismatch' THEN RAISE EXCEPTION 'native_voice_actor_spoof_accepted: %',replay;END IF;
 PERFORM set_config('role','none',true);
 IF action_state IS DISTINCT FROM (SELECT jsonb_build_object('hand',to_jsonb(row),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE a.hand_id=h.id)) FROM public.tournament_hands row WHERE id=h.id) THEN RAISE EXCEPTION 'native_voice_retry_or_denial_changed_source';END IF;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 replay:=public._tracker_voice_register_validated_event('${f.actor}','${f.tour}','${table.id}',h.id,'openai_realtime','gpt-live-transcribe',k||'-stale',NULL,'check',command,state,'assist',k||'-stale','native-stale-trace','enforce',true,NULL);
 IF replay->>'error' IS DISTINCT FROM 'stale_state_version' THEN RAISE EXCEPTION 'native_voice_stale_registration_accepted: %',replay;END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT count(*) FROM public.hand_actions WHERE hand_id=h.id)<>1 OR (SELECT count(*) FROM public.tracker_voice_events WHERE hand_id=h.id AND event_kind='final_transcript')<>1 THEN RAISE EXCEPTION 'native_voice_duplicate_or_stale_delta';END IF;
 IF public._tracker_voice_hand_state_version(h.id)=state OR (SELECT source_revision FROM public.tournament_hands WHERE id=h.id)<=h.source_revision THEN RAISE EXCEPTION 'native_voice_action_revision_not_invalidated';END IF;
 INSERT INTO native_voice_payloads VALUES('voice_action',jsonb_build_object('receipt',receipt,'action',r,'stale',replay,'assignment_denial',assignment_denial,'handoff_denial',handoff_denial,
 'request_identity',jsonb_build_object('idempotencyKey',k,'traceId','native-voice-trace','expectedStateVersion',state,'executionMode','assist','providerEventId',k)));
 END $$;
 SELECT jsonb_object_agg(k,v) FROM native_voice_payloads;
 ROLLBACK;`));
 assert.equal(payload.owner.ok,true);assert.equal(payload.owner.active_hand,null);assert.equal(payload.owner.can_mint_session,true);
 assert.equal(await loader(payload.owner,null,f.tour,table.id).read(),payload.owner);
 for(const runtime of [payload.owner_active,payload.floor_active]){
  assert.equal(runtime.ok,true);assert.equal(runtime.can_mint_session,true);assert.equal(runtime.active_hand.status,'in_progress');
  assert.match(runtime.active_hand.state_version,/^[a-f0-9]{64}$/);assert.equal(await loader(runtime,null,f.tour,table.id).read(),runtime);
 }
 assert.equal(payload.owner_active.active_hand.hand_id,payload.floor_active.active_hand.hand_id);
 assert.equal(payload.owner_active.active_hand.hand_id,payload.hand_proof.hand_id);
 assert.equal(payload.owner_active.active_hand.state_version,payload.hand_proof.state_version);
 assert.equal(payload.floor_active.active_hand.state_version,payload.hand_proof.state_version);
 assert.equal(payload.hand_proof.players,2);assert.equal(payload.hand_proof.starting_stack,40000);
 // Recompute the actual Edge workflow using its actual shared engine, not a fixture label.
 const edgeSource=readFileSync(new URL('../../supabase/functions/tournament-live-update/index.ts',import.meta.url),'utf8');
 const edgeTree=parseSync(edgeSource,{syntax:'typescript'});
 const workflowNode=edgeTree.body.find(n=>n.type==='FunctionDeclaration'&&n.identifier.value==='workflowForVoiceSnapshot');
 assert.ok(workflowNode);
 const workflowSource=Buffer.from(edgeSource).subarray(workflowNode.span.start-edgeTree.span.start,workflowNode.span.end-edgeTree.span.start).toString();
 const engineSource=readFileSync(new URL('../../src/lib/tracker-poker/handStateCore.ts',import.meta.url),'utf8').replace(/^export /gm,'');
 const workflowCode=transformSync(engineSource+'\n'+workflowSource+'\nworkflowForVoiceSnapshot;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 const workflow=runInNewContext(workflowCode,{actionWorkflowForStreet});
 assert.equal(workflow(payload.board_workflow.snapshot),'enter_flop');
 const snapshotRoute=routeTrackerVoiceIntent(boardTranscript,workflow(payload.board_workflow.snapshot));
 assert.equal(snapshotRoute.ok,true);assert.equal(snapshotRoute.intentDomain,'board');
 const expectedCanonical=await buildVoiceBoardCanonicalRequest({rawTranscript:boardTranscript,
  expectedStateVersion:payload.board_workflow.snapshot.state_version,expectedWorkflowState:workflow(payload.board_workflow.snapshot),
  expectedStreet:snapshotRoute.command.street,payload:{street:snapshotRoute.command.street,newCards:snapshotRoute.command.newCards,
   cumulativeCards:[...payload.board_workflow.snapshot.community_cards,...snapshotRoute.command.newCards],expectedExistingBoardCount:0}});
 assert.deepEqual(payload.board_workflow.canonical_request,expectedCanonical);
 let boardCommitCalls=0;
 const commitBoard=runInNewContext(boardCommitCode,{Error,client:{functions:{invoke:async(name,{body})=>{
  boardCommitCalls++;assert.equal(name,'tournament-live-update');assert.equal(body.action,'commit_voice_board');
  assert.equal(body.voice_event_id,payload.board_workflow.commit_request.voiceEventId);assert.equal(body.hand_id,payload.hand_proof.hand_id);
  return {data:{data:payload.board_workflow.commit},error:null};
 }}}});
 assert.equal(await commitBoard({...payload.board_workflow.commit_request,tournamentId:f.tour,tournamentTableId:table.id,
  handId:payload.hand_proof.hand_id,canonicalRequest:expectedCanonical}),payload.board_workflow.commit);
 assert.equal(boardCommitCalls,1);
 assert.equal(workflow(payload.hole_workflow.snapshot),'runout_reveal');
 const holeIdentity=payload.hole_workflow.request_identity;
 let holeCalls=0;
 const commitHole=runInNewContext(holeCommitCode,{Error,client:{functions:{invoke:async()=>{
  holeCalls++;return {data:{data:payload.hole_workflow.receipt},error:null};
 }}}});
 assert.equal(await commitHole({...holeIdentity,tournamentId:f.tour,tournamentTableId:table.id,handId:payload.hand_proof.hand_id,
  canonicalRequest:{intentDomain:'hole_cards',envelope:{expectedStateVersion:holeIdentity.expectedStateVersion},
   payload:{expectedPlayerId:holeIdentity.playerId,expectedEntryNumber:holeIdentity.entryNumber,seatNumber:holeIdentity.seatNumber,cards:['Kh','Ks']}}}),payload.hole_workflow.receipt);
 assert.equal(holeCalls,1);
 assert.equal(payload.board_workflow.snapshot.actions.length,4);
 assert.equal(payload.board_workflow.commit.ok,true);
 assert.equal(payload.board_workflow.commit.state_version_before,payload.board_workflow.snapshot.state_version);
 assert.notEqual(payload.board_workflow.commit.state_version_after,payload.board_workflow.snapshot.state_version);
 assert.equal(payload.voice_action.receipt.ok,true);assert.equal(payload.voice_action.action.source,'voice');
 assert.equal(payload.voice_action.stale.error,'stale_state_version');
 assert.equal(payload.voice_action.assignment_denial.error,'dealer_assignment_lost');
 assert.equal(payload.voice_action.handoff_denial.error,'dealer_assignment_lost');
 let validationCalls=0;
 const validate=runInNewContext(validationCode,{Error,client:{functions:{invoke:async(name,{body})=>{
  validationCalls++;assert.equal(name,'tournament-live-update');assert.equal(body.expected_state_version,payload.voice_action.request_identity.expectedStateVersion);
  assert.equal(body.hand_id,payload.hand_proof.hand_id);return {data:{data:payload.voice_action.receipt},error:null};
 }}}});
 assert.equal(await validate({...payload.voice_action.request_identity,tournamentId:f.tour,tournamentTableId:table.id,handId:payload.hand_proof.hand_id,
  finalTranscript:'check',providerName:'openai_realtime',providerModel:'gpt-live-transcribe'}),payload.voice_action.receipt);
 assert.equal(validationCalls,1);
 const validateBoard=runInNewContext(validationCode,{Error,client:{functions:{invoke:async()=>({data:{data:payload.voice_board.receipt},error:null})}}});
 assert.equal(Object.hasOwn(payload.voice_board.receipt,'alert_id'),false);
 const boardResult=await validateBoard({...payload.voice_board.request_identity,tournamentId:f.tour,tournamentTableId:table.id,handId:payload.hand_proof.hand_id,
  finalTranscript:'Flop ace hearts five spades two diamonds',providerName:'openai_realtime',providerModel:'gpt-live-transcribe',canonicalRequest:{intentDomain:'board'}});
 assert.equal(boardResult.alert_id,null);
 assert.equal(JSON.stringify({...boardResult,alert_id:undefined}),JSON.stringify(payload.voice_board.receipt));
 assert.equal(payload.paid_chips.color_up.rounding_delta,0);assert.equal(payload.paid_chips.undo.bank_reversed,true);
 assert.equal(payload.outsider.ok,false);assert.equal(payload.outsider.error,'dealer_assignment_missing');
 await assert.rejects(loader(payload.outsider,null,f.tour,table.id).read(),/dealer_assignment_missing/);
 assert.equal(fingerprint(),before);
 assert.equal(sql(`SELECT count(*) FROM public.dealers WHERE club_id='${f.club}' AND full_name='Native Voice Telegram TEST';`),'0');
 assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${floorActor}';`),'0');
 console.log('NATIVE_VOICE_PAID_HAND_MANUAL_SWING_OLD_RECEIPT_ROLLBACK_PASS');
});
