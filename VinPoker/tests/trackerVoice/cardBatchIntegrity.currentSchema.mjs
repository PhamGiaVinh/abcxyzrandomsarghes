import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
const fixtureOnly=process.argv.includes('--fixture-only');
const manualFinish94Fixture=process.argv.includes('--manual-finish94-lock-fixture');
const undo=process.argv.includes('--undo');
const authority70=process.argv.includes('--authority70');
const manualHoleAuthority=process.argv.includes('--manual-hole-authority');
const manualHolePrototype=process.argv.includes('--manual-hole-prototype');
const manualHoleRelease75=process.argv.includes('--manual-hole-release75');
const manualHoleRelease75Full=process.argv.includes('--manual-hole-release75-full');
const manualHoleRelease75Payload=process.argv.includes('--manual-hole-release75-payload');
const manualHoleRelease75Ci=process.argv.includes('--manual-hole-release75-ci');
const manual75OverlapFixture=process.argv.includes('--manual75-overlap-fixture');
assert.ok(!manual75OverlapFixture||manualHoleRelease75Payload,'manual75 overlap fixture requires canonical payload75');
if(manual75OverlapFixture) assert.equal(process.env.PGPORT,manualHoleRelease75Ci?'55441':'55464');
if(manualHoleRelease75Ci){assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true');assert.equal(process.env.PGPORT,'55441');assert.ok(manualHoleRelease75Payload);}
assert.ok(!manualHoleRelease75Payload||(manualHoleRelease75&&!manualHoleRelease75Full),'payload75 requires its own canonical clone');
assert.ok(!manualHoleRelease75Full||manualHoleRelease75,'full75 clone requires canonical release75 matrix');
assert.ok(!manualHoleRelease75||manualHolePrototype,'release75 reuses the guarded manual prototype matrix');
assert.ok(!manualHolePrototype||(manualHoleAuthority&&authority70),'manual prototype requires guarded authority fixture');
assert.ok(!manualHoleAuthority||authority70,'manual hole authority requires guarded owned schema mode');
const authorityBaseline=process.argv.includes('--authority-baseline');
const authorityRelease71=process.argv.includes('--authority-release71');
const manualFinish94=process.argv.includes('--manual-finish94');
const manualFinishRetired96=process.argv.includes('--manual-finish-retired96');
assert.ok(!manualFinishRetired96||manualFinish94,'Finish96 reuses the reviewed Finish94 Voice compatibility matrix');
const authorityOverlapFixture=process.argv.includes('--authority-overlap-fixture');
const authorityReverseRoot=process.argv.includes('--authority-reverse-root');
const authorityAssignment72=process.argv.includes('--authority-assignment72');
const authorityAssignment72Baseline=process.argv.includes('--authority-assignment72-baseline');
const authorityVoiceFirst72=process.argv.includes('--authority-voice-first72');
const authorityCloseFirst72=process.argv.includes('--authority-close-first72');
const authorityLockOrder73=process.argv.includes('--authority-lock-order73');
const authorityPendingMode73=process.argv.includes('--authority-pending-mode73');
assert.ok(!authorityPendingMode73||(authorityLockOrder73&&authorityVoiceFirst72),'pending-mode73 requires owned Voice-first fixture');
assert.ok(!authorityLockOrder73||(authorityAssignment72&&authorityOverlapFixture&&!authorityAssignment72Baseline&&!authorityCloseFirst72),'lock-order73 requires its owned canonical overlap fixture');
assert.ok(!authorityCloseFirst72||(authorityAssignment72&&authorityOverlapFixture&&!authorityAssignment72Baseline&&!authorityVoiceFirst72),'close-first72 only prepares its owned overlap fixture');
assert.ok(!authorityVoiceFirst72||(authorityAssignment72&&authorityOverlapFixture&&!authorityAssignment72Baseline),'voice-first72 only prepares its owned overlap fixture');
assert.ok(!authorityAssignment72Baseline||(authorityAssignment72&&authorityOverlapFixture),'baseline72 comparison only prepares the owned old-helper root fixture');
const authorityFenceEpoch=process.argv.includes('--authority-fence-epoch');
const authorityFenceRevoked=process.argv.includes('--authority-fence-revoked');
const authorityFenceAttendance=process.argv.includes('--authority-fence-attendance');
const authorityFinishAttendance72=process.argv.includes('--authority-finish-attendance72');
const attendanceCaseArg=process.argv.find(arg=>arg.startsWith('--authority-attendance-case='));
const attendanceCase=attendanceCaseArg?.split('=')[1]??'checkout';
assert.ok(!attendanceCaseArg||authorityFenceAttendance||authorityFinishAttendance72,'attendance tuple case requires isolated attendance fence');
const attendanceMutations={
 transition:`DO $checkout$ DECLARE result jsonb; BEGIN
   result:=public.transition_dealer_state('87500000-0000-4000-8000-000000000001','checked_out','dealer_checkout');
   IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'from' IS DISTINCT FROM 'assigned' OR result->>'to' IS DISTINCT FROM 'checked_out' THEN RAISE EXCEPTION 'canonical_checkout_transition_failed: %',result; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='87500000-0000-4000-8000-000000000001' AND status='checked_in' AND check_out_time IS NULL AND current_state='checked_out') THEN RAISE EXCEPTION 'checkout_intermediate_boundary_missing'; END IF;
 END $checkout$;`,
 checkout:"UPDATE public.dealer_attendance SET check_out_time=now() WHERE id='87500000-0000-4000-8000-000000000001';",
 checkedout:"UPDATE public.dealer_attendance SET status='checked_out',current_state='checked_out',check_out_time=now() WHERE id='87500000-0000-4000-8000-000000000001';",
 unavailable:"UPDATE public.dealer_attendance SET current_state='available' WHERE id='87500000-0000-4000-8000-000000000001';",
 mismatch:"UPDATE public.dealer_attendance SET current_state='assigned' WHERE id='87500000-0000-4000-8000-000000000003'; UPDATE public.dealer_assignments SET attendance_id='87500000-0000-4000-8000-000000000003' WHERE id='88000000-0000-4000-8000-000000000001';",
 club:"UPDATE public.dealer_assignments SET club_id='81000000-0000-4000-8000-000000000002' WHERE id='88000000-0000-4000-8000-000000000001';",
 deleted:"UPDATE public.dealers SET deleted_at=now() WHERE id='87000000-0000-4000-8000-000000000001';",
};
assert.ok(Object.hasOwn(attendanceMutations,attendanceCase),'unsupported attendance tuple case');
const authorityFence=authorityFenceEpoch||authorityFenceRevoked||authorityFenceAttendance;
assert.ok([authorityFenceEpoch,authorityFenceRevoked,authorityFenceAttendance].filter(Boolean).length<=1,'choose one lifecycle fence scenario');
assert.ok(!authorityAssignment72||(authorityRelease71&&!authorityReverseRoot),'assignment72 requires exact ordered release71 clone');
assert.ok(!authorityFenceAttendance||authorityAssignment72,'attendance fence requires assignment72');
assert.ok(!authorityFence||authorityRelease71,'lifecycle fence requires exact release71');
assert.ok(!authorityBaseline||authority70,'baseline comparison requires authority70 scenario');
assert.ok(!authorityRelease71||(authority70&&!authorityBaseline),'release71 requires ordered authority package, not baseline');
assert.ok(!authorityOverlapFixture||authorityRelease71,'overlap fixture requires exact release71');
assert.ok(!authorityReverseRoot||(authorityRelease71&&!authorityOverlapFixture),'reverse root requires established exact overlap fixture');
const authorityDatabase=manualHoleRelease75Ci?'vinpoker_manual_card75_payload_ci':manualHoleRelease75Payload?'vinpoker_manual_card75_payload_20261014':manualHoleRelease75Full?'vinpoker_manual_card75_rollback_20261014':manualHoleRelease75?'vinpoker_manual_card75_release_20261014':manualHolePrototype?'vinpoker_manual_card75_20261014':authorityPendingMode73?'vinpoker_voice_swing73_pending_20261014':authorityLockOrder73?(authorityVoiceFirst72?'vinpoker_voice_swing73_voice_first_qualified_20261014':'vinpoker_voice_swing73_swing_first_qualified_20261014'):authorityCloseFirst72?'vinpoker_voice_assignment72_close_first_20261014':authorityVoiceFirst72?'vinpoker_voice_assignment72_voice_first_20261014':authorityAssignment72Baseline?'vinpoker_voice_assignment72_authority_red_20261014':authorityAssignment72?(authorityOverlapFixture?'vinpoker_voice_assignment72_authority_overlap_20261014':'vinpoker_voice_assignment72_authority_20261014'):authorityOverlapFixture||authorityReverseRoot?'vinpoker_voice_release71_overlap_20261014':authorityRelease71?'vinpoker_voice_release71_20261014':authorityBaseline?'vinpoker_voice_dealer_baseline_20261014':'vinpoker_voice_migration70_20261014';
const authorityAction=process.argv.includes('--authority-action');
const manual75Database=manualFinishRetired96?'vinpoker_voice_finish96_20261016':manualFinish94?'vinpoker_voice_finish94_20261016':manual75OverlapFixture?'vinpoker_manual_card75_overlap_20261014':authorityDatabase;
const authorityFinish=process.argv.includes('--authority-finish');
const authorityFloorFinish=process.argv.includes('--authority-floor-finish');
assert.ok(!authorityFinishAttendance72||(authorityAssignment72&&authorityFinish&&authorityFloorFinish&&!authorityOverlapFixture),'Finish attendance negative requires qualified Floor Finish');
const authorityCanonicalStart=process.argv.includes('--authority-canonical-start');
assert.ok(!authorityFloorFinish||authorityFinish,'Floor finish requires existing finish fixture');
assert.ok(!authorityAction||authority70,'action authority scenario requires authority70');
const authorityOwner=process.argv.includes('--authority-owner');
assert.ok(!manualFinish94||(authorityRelease71&&authorityAssignment72&&authorityOwner&&authorityFinish&&!manualHoleAuthority&&!authorityOverlapFixture&&!authorityReverseRoot),'Finish94 requires the exact dedicated Owner/Finish/assignment72 clone');
assert.ok(!authorityOwner||authority70,'owner authority scenario requires authority70');
assert.ok(!authorityCanonicalStart||(authorityRelease71&&authorityOwner),'canonical start requires qualified release71 Owner fixture without added Tracker grants');
assert.ok(!authorityFinish||(authority70&&authorityOwner&&!authorityAction),'current-schema Finish fixture requires existing Owner path and full card suites');
if(authority70){
 assert.equal(process.env.PGUSER,'postgres');
 assert.ok(Number.isInteger(Number(process.env.PGPORT))&&Number(process.env.PGPORT)>0&&Number(process.env.PGPORT)<=65535);
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key],`${key} override forbidden for authority70`);
}
if(undo){
 assert.equal(process.env.PGPORT,'55441');
 assert.equal(process.env.PGUSER,'postgres');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key],`${key} override forbidden for undo fixture`);
}
const voiceHoles=process.argv.includes('--voice-holes')||authority70;
const voiceBoard=process.argv.includes('--voice-board')||voiceHoles;
assert.ok(!(fixtureOnly&&voiceBoard));
assert.ok(!manualFinish94Fixture||(fixtureOnly&&!authority70&&!undo),'Finish94 lock fixture only seeds its dedicated isolated database');
assert.ok(!(undo&&(fixtureOnly||voiceBoard)));
assert.equal(process.env.PGDATABASE,authority70?manual75Database:undo?'vinpoker_ops_undo_generation_20261011':fixtureOnly?(manualFinish94Fixture?'vinpoker_ops_finish94_ci':'vinpoker_ops_card56_overlap_20261011'):'vinpoker_ops_card56_20261011');
// Reuse existing Voice identities/session fixture, with real schema-required
// club names. No helper replacement, trigger disable, or role elevation.
const fixture=readFileSync('tests/trackerVoice/disposableDb.integration.sql','utf8');
assert.ok(fixture.indexOf('INSERT INTO public.tracker_voice_configs')>fixture.indexOf('INSERT INTO public.hand_players('),'fixture boundary must follow initial hand roster');
let prefix=fixture.slice(0,fixture.indexOf('INSERT INTO public.tracker_voice_configs'))
 .replace(/INSERT INTO public\.clubs\(id, owner_id\) VALUES([\s\S]*?);/u,(_,rows)=>
  'INSERT INTO public.clubs(id, owner_id, name, region) VALUES'+rows.replaceAll("')","','Card integrity TEST','TEST')")+';')
 .replace('public.club_trackers(club_id, user_id)','public.club_trackers(club_id, user_id, granted_by)')
 .replace("('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001')")
 .replace('public.tournaments(id, club_id, name, status)','public.tournaments(id, club_id, name, status, live_status)')
 .replace("'Voice V0 TEST', 'active')","'Voice V0 TEST', 'live', 'playing')")
 .replace("'Other Club TEST', 'active')","'Other Club TEST', 'live', 'playing')");
assert.equal(prefix.split('INSERT INTO public.tournament_hands(').length,2,'unique initial hand insert required');
if(undo){
 const start=prefix.indexOf('INSERT INTO public.dealers(');
 const end=prefix.indexOf('INSERT INTO public.tournament_hands(',start);
 assert.ok(start>0&&end>start,'legacy assignment fixture boundary missing');
 prefix=prefix.slice(0,start)+prefix.slice(end);
}
let qualified=prefix.replace('INSERT INTO public.tournament_hands(',
 readFileSync('tests/trackerVoice/cardBatchIntegrity.roster.sql','utf8')+'\nINSERT INTO public.tournament_hands(');
const configStart=fixture.indexOf('INSERT INTO public.tracker_voice_configs');
const configEnd=fixture.indexOf('-- Production repair shape:');
assert.ok(configEnd>configStart);
const dependencies=readFileSync('tests/trackerVoice/disposableDb.dependencies.sql','utf8');
const assertStart=dependencies.indexOf('CREATE OR REPLACE FUNCTION public.tracker_voice_test_assert(');
const assertEnd=dependencies.indexOf("SELECT 'TRACKER_VOICE_DEPENDENCIES_READY'");
assert.ok(assertStart>=0&&assertEnd>assertStart);
const actor=authority70&&!authorityOwner?'81300000-0000-4000-8000-000000000001':'81100000-0000-4000-8000-000000000001';
if(authorityCanonicalStart){
 const boundary=qualified.indexOf('INSERT INTO public.tournament_hands(');
 assert.ok(boundary>0,'initial hand fixture boundary missing');
 qualified=qualified.slice(0,boundary)+`
 SET ROLE authenticated;
 SELECT set_config('request.jwt.claim.sub','${actor}',false);
 SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',false);
 SELECT public.start_tracker_hand_v3('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001',1,1,now(),'${actor}',1)::text AS payload \\gset canonical_start_
 RESET ROLE;
 SELECT (:'canonical_start_payload'::jsonb->>'hand_id') AS id \\gset canonical_hand_
 SELECT set_config('voice70.canonical_hand_id',:'canonical_hand_id',true);
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE table_id='84000000-0000-4000-8000-000000000001' AND tournament_table_id='84000000-0000-4000-8000-000000000001' AND table_session_id='83500000-0000-4000-8000-000000000001' AND status='in_progress') THEN RAISE EXCEPTION 'canonical_start_lineage_missing'; END IF; END $$;
 `;
}
let holes=readFileSync('tests/trackerVoice/holeCardsAssist.integration.sql','utf8').replaceAll('81200000-0000-4000-8000-000000000001',actor);
if(authority70&&!authorityOwner){
 assert.ok(holes.includes("(:'manual_second_payload'::JSONB->>'status') = 'success'"));
 holes=holes.replace("(:'manual_second_payload'::JSONB->>'status') = 'success'","(:'manual_second_payload'::JSONB->>'error') = 'hand_not_found'")
 .replace("hole_cards = '[\"Qh\", \"Qs\"]'::JSONB","hole_cards = '[]'::JSONB")
 .replace('manual exact one-seat entry shares the core without clearing another confirmed seat','Floor direct core remains RLS-hidden and zero-write')
 .replace('TRACKER_VOICE_HOLE_CARDS_ASSIST_DISPOSABLE_DB_PASS','VOICE70_FLOOR_HOLE_RECEIPT_BOUNDARY_PASS');
}
let cases=undo?readFileSync('tests/trackerCorrectionRelease2/undoGeneration.currentSchema.sql','utf8'):voiceBoard?dependencies.slice(assertStart,assertEnd)+fixture.slice(configStart,configEnd)+
 (authority70?"\nUPDATE public.dealers SET user_id=NULL WHERE id='87000000-0000-4000-8000-000000000001';\n":'')+
 "\nINSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;\n"+
 readFileSync('tests/trackerVoice/boardAssist.integration.sql','utf8').replaceAll('81200000-0000-4000-8000-000000000001',actor).replace(
  'SELECT public.tracker_voice_test_assert(',"\\echo :board_root_flop_payload\nSELECT public.tracker_voice_test_assert(")+
 (voiceHoles?"\nINSERT INTO public.hand_actions(hand_id,player_id,entry_number,street,action_type,action_amount,action_order) VALUES('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',1,'preflop','call',100,1);\n"+
 holes:'')+(authority70&&!authorityBaseline?'\n'+readFileSync('tests/trackerVoice/sharedBoardAuthority.boundaries.sql','utf8'):''):
 readFileSync('tests/trackerVoice/cardBatchIntegrity.currentSchema.cases.sql','utf8');
if(authorityAction){
 const start=fixture.indexOf('-- Register one final transcript using the server-derived assignment/state.');
 const end=fixture.indexOf('-- Exercise the unique-violation retry branch',start);
 assert.ok(start>configEnd&&end>start,'existing action/replay boundary missing');
 cases=dependencies.slice(assertStart,assertEnd)+fixture.slice(configStart,configEnd)+`
 INSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
 UPDATE public.dealers SET user_id=NULL WHERE id='87000000-0000-4000-8000-000000000001';
 UPDATE public.tracker_voice_configs SET enabled=true,configured_mode='assist',provider_model='gemini-3.5-transcribe-live',correction_state='ready' WHERE tournament_table_id='84000000-0000-4000-8000-000000000001';
 SELECT set_config('request.jwt.claim.sub','${actor}',false);
 SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"service_role"}',false);
 `+fixture.slice(start,end).replaceAll('81200000-0000-4000-8000-000000000001',actor)+
 (authorityBaseline?'':'\n'+readFileSync('tests/trackerVoice/sharedBoardAuthority.boundaries.sql','utf8'));
}
if(authorityFinish){
 let finish=readFileSync('tests/trackerVoice/finishAssist.integration.sql','utf8');
 const start=finish.indexOf('-- record_hand verifies the live seat, entry and chip projections');
 const end=finish.indexOf("SELECT public._tracker_voice_hand_state_version('860",start);
 assert.ok(start>0&&end>start,'Finish fixture duplicate projection boundary missing');
 // cardBatchIntegrity.roster.sql already supplies this exact entry/seat/chip
 // projection. Do not create a second participation instance for the same hand.
 finish=(finish.slice(0,start)+finish.slice(end)).replaceAll('81200000-0000-4000-8000-000000000001',actor);
 if(authorityFloorFinish){
  const boundary=finish.indexOf("SELECT public._tracker_voice_hand_state_version('860");
  assert.ok(boundary>0,'finish state boundary missing');
  const floor='81300000-0000-4000-8000-000000000001';
  finish=finish.slice(0,boundary)+`
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub','${floor}',false);
  SELECT set_config('request.jwt.claims','{"sub":"${floor}","role":"authenticated"}',false);
  SELECT public.takeover_hand_lock('86000000-0000-4000-8000-000000000001',true,'${floor}')::text AS payload \\gset finish_floor_lock_
  RESET ROLE;
  SELECT public.tracker_voice_test_assert((:'finish_floor_lock_payload'::jsonb->>'ok')::boolean,'authorized Floor claims exact hand through canonical takeover');
  `+finish.slice(boundary).replaceAll(actor,floor);
 }
 if(authorityFinishAttendance72){
  const boundary=finish.indexOf('-- A bad digest cannot finish the hand');
  assert.ok(boundary>0,'existing valid Finish payload boundary missing');
  const floor='81300000-0000-4000-8000-000000000001';
  const projection=`md5(jsonb_build_object(
   'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.tournament_entries e WHERE e.tournament_id='85000000-0000-4000-8000-000000000001'),
   'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s WHERE s.tournament_id='85000000-0000-4000-8000-000000000001'),
   'chips',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.player_id,c.entry_number) FROM public.tournament_chip_counts c WHERE c.tournament_id='85000000-0000-4000-8000-000000000001'))::text)`;
  finish=finish.slice(0,boundary)+`
  SELECT ${projection} AS value \\gset finish72_projection_before_
  ${attendanceMutations[attendanceCase]}
  SET ROLE service_role;
  SELECT set_config('request.jwt.claim.sub','${floor}',false);
  SELECT set_config('request.jwt.claims','{"sub":"${floor}","role":"service_role"}',false);
  SELECT public.commit_tracker_voice_finish_v0('${floor}',
   '85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',
   '86000000-0000-4000-8000-000000000001','gemini_live','gemini-3.5-transcribe-live','finish72-invalid-attendance',
   'kết thúc hand',:'finish_state_value','voice-finish-attendance72-0001','trace-finish-attendance72',
   'engine_showdown',repeat('2',64),:'finish_record_payload_value'::jsonb)::text AS payload \\gset finish72_denied_
  RESET ROLE;
  \\echo :finish72_denied_payload
  SELECT public.tracker_voice_test_assert(
   :'finish72_denied_payload'::jsonb->>'error'='dealer_assignment_invalid'
   AND (SELECT status='in_progress' FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001')
   AND public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001')=:'finish_state_value'
   AND (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='85000000-0000-4000-8000-000000000001' AND current_stack=30000)=2
   AND (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='85000000-0000-4000-8000-000000000001' AND is_active AND chip_count=30000)=2
   AND ${projection}=:'finish72_projection_before_value'
   AND NOT EXISTS(SELECT 1 FROM public.tracker_voice_events WHERE idempotency_key='voice-finish-attendance72-0001'),
   'Finish rejects attendance tuple ${attendanceCase}; no hand/source/entry/seat/chip/root mutation');
  `;
 }
 cases+='\n'+finish;
}
if(authorityCanonicalStart) cases=cases.replaceAll("'86000000-0000-4000-8000-000000000001'","current_setting('voice70.canonical_hand_id')::uuid");
if(authorityFence){
 assert.ok(!authorityOwner&&!authorityAction&&!authorityFinish&&!authorityCanonicalStart&&!authorityOverlapFixture&&!authorityReverseRoot,'lifecycle fence uses isolated Floor root only');
 const boundary=cases.indexOf('SELECT public.commit_tracker_voice_board_v0(');
 assert.ok(boundary>0,'immutable root fixture boundary missing');
 cases=cases.slice(0,boundary)+`
 RESET ROLE;
 ${authorityFenceAttendance?attendanceMutations[attendanceCase]:authorityFenceEpoch?"UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id='83500000-0000-4000-8000-000000000001'; UPDATE public.tracker_voice_configs SET enabled=true,correction_state='ready' WHERE tournament_table_id='84000000-0000-4000-8000-000000000001';":"DELETE FROM public.club_floors WHERE club_id='81000000-0000-4000-8000-000000000001' AND user_id='81300000-0000-4000-8000-000000000001';"}
 SET ROLE authenticated;
 SELECT public.commit_tracker_voice_board_v0((:'board_root_flop_payload'::jsonb->>'voice_event_id')::uuid,'voice-board-flop-0001','trace-board-fence')::text AS payload \\gset lifecycle_fence_
 RESET ROLE;
 SELECT public.tracker_voice_test_assert(
 :'lifecycle_fence_payload'::jsonb->>'error'='${authorityFenceAttendance?'dealer_assignment_invalid':authorityFenceEpoch?'stale_state_version':'dealer_assignment_missing'}'
 AND (SELECT community_cards='[]'::jsonb FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM public.tracker_voice_events WHERE root_event_id=(:'board_root_flop_payload'::jsonb->>'voice_event_id')::uuid),
 'old Floor proposal rejected after ${authorityFenceAttendance?`attendance tuple ${attendanceCase}`:authorityFenceEpoch?'epoch change with fresh config re-enabled':'Floor authority revoked'}; no cards or child receipt');
 `+readFileSync('tests/trackerVoice/sharedBoardAuthority.boundaries.sql','utf8');
}
if(authorityOverlapFixture){
 assert.ok(!authorityOwner&&!authorityAction&&!authorityFinish&&!authorityCanonicalStart,'overlap fixture uses isolated Floor root only');
 const boundary=cases.indexOf('SELECT public.commit_tracker_voice_board_v0(');
 assert.ok(boundary>0,'immutable root fixture boundary missing');
 cases=cases.slice(0,boundary)+'\nRESET ROLE;\n';
}
if(authorityReverseRoot){
 assert.ok(!authorityOwner&&!authorityAction&&!authorityFinish&&!authorityCanonicalStart,'reverse root is isolated Floor scenario');
 const board=readFileSync('tests/trackerVoice/boardAssist.integration.sql','utf8');
 const state=board.indexOf("SELECT public._tracker_voice_hand_state_version('860");
 const boundary=board.indexOf('SET ROLE authenticated;',state);
 assert.ok(state>0&&boundary>state,'existing reverse-root registration boundary missing');
 qualified='';
 cases=board.slice(0,boundary).replaceAll('81200000-0000-4000-8000-000000000001',actor)
 .replaceAll('voice-board-flop-0001','voice-board-reverse-0001')
 .replaceAll('trace-board-flop-0001','trace-board-reverse-0001')
 .replaceAll('board-flop-provider-1','board-reverse-provider-1');
}
if(manualHoleAuthority){
 assert.ok(!fixtureOnly&&!authorityOverlapFixture&&!authorityOwner&&!authorityFinish,
  'manual hole regression must use the original assigned Dealer rollback fixture');
 cases="SELECT set_config('manual75.fixture','owned-manual-authority',true);\n"+readFileSync(manualHolePrototype?'tests/trackerVoice/manualCardAuthority.prototype.cases.sql'
  :'tests/trackerVoice/manualHoleAuthority.currentSchema.sql','utf8');
 if(manualHoleRelease75){
  for(const [before,after] of [
   ['vinpoker_manual_card75_20261014',manual75Database],
   ['public.show_manual_cards_prototype','public.show_tracker_manual_cards_v1'],
   ['public.get_manual_card_receipt_prototype','public.get_tracker_manual_card_receipt_v1'],
   ['floor_private.manual_cards_prototype','floor_private.tracker_manual_cards_v1'],
   ['floor_private.manual_card_receipt_prototype','floor_private.tracker_manual_card_receipt_v1'],
   ['floor_private.manual_card_receipts_prototype','floor_private.tracker_manual_card_receipts_v1'],
   ['419f17a4a04937244c2519b75d4c4b96','37faf2e637e06d255c0f9186d3a7e9e9'],
   ['e5a5f946ed187baf910cbc7f7de8e746','0e43636469573f0f9722639ca283f346'],
   ['914e90524f7ef265c65c421dd680f05c','47b08ebea2d7909ae8e8d99864440560'],
   ['ff336d471723c238d35529f315fc2202','29f9eeb5563d236d0c6de4cf8c0f98b9'],
  ]) cases=cases.replaceAll(before,after);
  cases=cases.replaceAll('floor_private.tracker_manual_card_receipt_v1(text)','floor_private.tracker_manual_card_receipt_v1(text,jsonb)')
   .replaceAll('public.get_tracker_manual_card_receipt_v1(text)','public.get_tracker_manual_card_receipt_v1(text,jsonb)')
   .replaceAll("proargnames=ARRAY['p_request_key']::text[]","proargnames=ARRAY['p_request_key','p_expected_payload']::text[]")
   .replaceAll("public.get_tracker_manual_card_receipt_v1('manual-prototype-key-0001')",
    "public.get_tracker_manual_card_receipt_v1('manual-prototype-key-0001',jsonb_build_object('hand_id','86000000-0000-4000-8000-000000000001','table_session_id','83500000-0000-4000-8000-000000000001','control_epoch',1,'expected_source_revision',:manual_before_revision,'player_hole_cards','[{\"player_id\":\"82000000-0000-4000-8000-000000000002\",\"entry_number\":1,\"hole_cards\":[\"Qh\",\"Qs\"]}]'::jsonb))");
  cases+='\n'+readFileSync('tests/trackerVoice/manual75ReceiptPayload.cases.sql','utf8');
  if(manualHoleRelease75Ci) cases=cases.replaceAll('vinpoker_manual_card75_payload_20261014',authorityDatabase)
   .replaceAll('inet_server_port()<>55464','inet_server_port()<>55441');
  if(manual75OverlapFixture) cases=''; // Exact empty-clone guard below precedes committed synthetic fixture only.
 }
}
const preconditions=undo?`DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55441 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'wrong_undo_server'; END IF;
 IF current_database()<>'vinpoker_ops_undo_generation_20261011' OR EXISTS(SELECT 1 FROM public.clubs) THEN RAISE EXCEPTION 'wrong_or_nonempty_undo_database'; END IF;
 IF md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '273b34a53a9114af87d9d8bc940dce38'
 OR md5(replace(pg_get_functiondef('public.delete_last_action(uuid,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '37573f5c4a9c013bf8e7573767036d9f' THEN RAISE EXCEPTION 'undo_dependency_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision' AND tgenabled='O' AND md5(replace(pg_get_functiondef(tgfoid),chr(13),''))='14f9e44a3b7847753f36efc365b5b208') THEN RAISE EXCEPTION 'revision_trigger_drift: %',(SELECT jsonb_build_object('function',tgfoid::regprocedure::text,'enabled',tgenabled,'digest',md5(replace(pg_get_functiondef(tgfoid),chr(13),''))) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision'); END IF;
END $$;`:'';
const authorityPreconditions=authority70?`DO $$ BEGIN
 IF current_database()<>'${manual75Database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>${Number(process.env.PGPORT)} OR current_user<>'postgres' OR ${authorityReverseRoot?"(SELECT count(*) FROM public.clubs)<>2 OR (SELECT count(*) FROM public.tracker_voice_events WHERE event_kind='canonical_receipt')<>0":"EXISTS(SELECT 1 FROM public.clubs)"} THEN RAISE EXCEPTION 'wrong_authority70_fixture_database'; END IF;
 IF md5(replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'${authorityBaseline?'02fb54cede4cf42423abe72271375a8b':'f1f8d600607c96653f1ea1c0f950c119'}' THEN RAISE EXCEPTION 'authority70_state_dependency_drift'; END IF;
 ${authorityRelease71?`IF md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'${manualFinish94?'514d543b756792fcfc3277faa325d991':'16006fec6f3b9274581de471a9dc296a'}' THEN RAISE EXCEPTION 'release71_finish_dependency_drift'; END IF;`:''}
 ${authorityAssignment72?`IF md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'${authorityAssignment72Baseline?'96ba904dfcdfaa23dba36b6862aba168':'0a9e1f4e0972015b1554d6cd10f5ee2a'}' THEN RAISE EXCEPTION 'assignment72_dependency_drift'; END IF;`:''}
 ${authorityCanonicalStart?"IF md5(replace(pg_get_functiondef('public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamp with time zone,uuid,integer)'::regprocedure),chr(13),''))<>'6b71e798f6239b7096342ef7e17e6784' OR md5(replace(pg_get_functiondef('floor_private.snapshot_tracker_hand_blinds()'::regprocedure),chr(13),''))<>'81554940f984d3349149cdeed959626e' OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgfoid='floor_private.snapshot_tracker_hand_blinds()'::regprocedure AND tgenabled='O') THEN RAISE EXCEPTION 'canonical_start_identity_dependency_drift'; END IF;":''}
END $$;`:'';
const useWsl=authority70&&process.platform==='win32';
if(useWsl) assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/u,'explicit owned WSL distro required');
const psqlArgs=['-X','-w','-v','ON_ERROR_STOP=1'];
const args=useWsl?['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql','-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U',process.env.PGUSER,'-d',process.env.PGDATABASE,...psqlArgs]:psqlArgs;
const result=spawnSync(useWsl?'wsl':'psql',args,
 // Public-only capture omits managed auth schema grants. Read-only live
 // privilege checks verified these three roles have USAGE and uid/jwt EXECUTE.
 // Mirror only in this rollback transaction; no public table grants or bypass.
 {input:`BEGIN;\n${preconditions}\n${authorityPreconditions}\nGRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated,service_role;\n${qualified}\n${fixtureOnly?'':cases}\n${fixtureOnly||authorityOverlapFixture||authorityReverseRoot||manual75OverlapFixture?'COMMIT':'ROLLBACK'};`.replaceAll('\r\n','\n'),encoding:'utf8'});
assert.equal(result.status,0,result.stderr+(voiceBoard?'\n'+result.stdout:''));
if(manualHoleAuthority){
 console.log(manual75OverlapFixture?'CURRENT_SCHEMA_MANUAL75_OVERLAP_FIXTURE_READY':manualHoleRelease75?'CURRENT_SCHEMA_MANUAL_CARD_RELEASE75_PASS':'CURRENT_SCHEMA_MANUAL_CARD_AUTHORITY_PASS');
 process.exit(0);
}
console.log(authorityFinishAttendance72?('CURRENT_SCHEMA_VOICE_FINISH_ATTENDANCE_'+attendanceCase.toUpperCase()+'_ZERO_WRITE_PASS'):authorityFenceAttendance?('CURRENT_SCHEMA_VOICE_ASSIGNMENT_TUPLE_'+attendanceCase.toUpperCase()+'_ZERO_WRITE_PASS'):authorityFenceEpoch?'CURRENT_SCHEMA_VOICE_EPOCH_REENABLE_STALE_ZERO_WRITE_PASS':authorityFenceRevoked?'CURRENT_SCHEMA_VOICE_REVOKED_FLOOR_ZERO_WRITE_PASS':authorityReverseRoot?'CURRENT_SCHEMA_RELEASE71_REVERSE_ROOT_READY':authorityOverlapFixture?'CURRENT_SCHEMA_RELEASE71_OVERLAP_ROOT_READY':authorityFloorFinish?'CURRENT_SCHEMA_VOICE_FLOOR_FINISH_RETRY_ROLLBACK_PASS':authorityFinish?'CURRENT_SCHEMA_VOICE_OWNER_FINISH_RETRY_ROLLBACK_PASS':authorityAction?'CURRENT_SCHEMA_VOICE70_ACTION_REPLAY_BOUNDARIES_PASS':authority70?'CURRENT_SCHEMA_VOICE70_CARD_WRAPPERS_BOUNDARIES_PASS':undo?'UNDO_GENERATION_HASH_QUEUE_REPLAY_CONFLICT_PASS':fixtureOnly?'CURRENT_SCHEMA_OVERLAP_FIXTURE_READY':voiceHoles?'CURRENT_SCHEMA_VOICE_CARD_WRAPPERS_PASS':voiceBoard?'CURRENT_SCHEMA_VOICE_BOARD_WRAPPER_PASS':'CURRENT_SCHEMA_CARD_AUTHORITY_REVISION_COMPLETION_QUEUE_PASS');
