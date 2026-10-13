import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
const fixtureOnly=process.argv.includes('--fixture-only');
const undo=process.argv.includes('--undo');
const authority70=process.argv.includes('--authority70');
const authorityBaseline=process.argv.includes('--authority-baseline');
const authorityRelease71=process.argv.includes('--authority-release71');
const authorityOverlapFixture=process.argv.includes('--authority-overlap-fixture');
const authorityReverseRoot=process.argv.includes('--authority-reverse-root');
assert.ok(!authorityBaseline||authority70,'baseline comparison requires authority70 scenario');
assert.ok(!authorityRelease71||(authority70&&!authorityBaseline),'release71 requires ordered authority package, not baseline');
assert.ok(!authorityOverlapFixture||authorityRelease71,'overlap fixture requires exact release71');
assert.ok(!authorityReverseRoot||(authorityRelease71&&!authorityOverlapFixture),'reverse root requires established exact overlap fixture');
const authorityDatabase=authorityOverlapFixture||authorityReverseRoot?'vinpoker_voice_release71_overlap_20261014':authorityRelease71?'vinpoker_voice_release71_20261014':authorityBaseline?'vinpoker_voice_dealer_baseline_20261014':'vinpoker_voice_migration70_20261014';
const authorityAction=process.argv.includes('--authority-action');
const authorityFinish=process.argv.includes('--authority-finish');
const authorityFloorFinish=process.argv.includes('--authority-floor-finish');
const authorityCanonicalStart=process.argv.includes('--authority-canonical-start');
assert.ok(!authorityFloorFinish||authorityFinish,'Floor finish requires existing finish fixture');
assert.ok(!authorityAction||authority70,'action authority scenario requires authority70');
const authorityOwner=process.argv.includes('--authority-owner');
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
assert.ok(!(undo&&(fixtureOnly||voiceBoard)));
assert.equal(process.env.PGDATABASE,authority70?authorityDatabase:undo?'vinpoker_ops_undo_generation_20261011':fixtureOnly?'vinpoker_ops_card56_overlap_20261011':'vinpoker_ops_card56_20261011');
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
 cases+='\n'+finish;
}
if(authorityCanonicalStart) cases=cases.replaceAll("'86000000-0000-4000-8000-000000000001'","current_setting('voice70.canonical_hand_id')::uuid");
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
const preconditions=undo?`DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55441 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'wrong_undo_server'; END IF;
 IF current_database()<>'vinpoker_ops_undo_generation_20261011' OR EXISTS(SELECT 1 FROM public.clubs) THEN RAISE EXCEPTION 'wrong_or_nonempty_undo_database'; END IF;
 IF md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '273b34a53a9114af87d9d8bc940dce38'
 OR md5(replace(pg_get_functiondef('public.delete_last_action(uuid,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '37573f5c4a9c013bf8e7573767036d9f' THEN RAISE EXCEPTION 'undo_dependency_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision' AND tgenabled='O' AND md5(replace(pg_get_functiondef(tgfoid),chr(13),''))='14f9e44a3b7847753f36efc365b5b208') THEN RAISE EXCEPTION 'revision_trigger_drift: %',(SELECT jsonb_build_object('function',tgfoid::regprocedure::text,'enabled',tgenabled,'digest',md5(replace(pg_get_functiondef(tgfoid),chr(13),''))) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision'); END IF;
END $$;`:'';
const authorityPreconditions=authority70?`DO $$ BEGIN
 IF current_database()<>'${authorityDatabase}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>${Number(process.env.PGPORT)} OR current_user<>'postgres' OR ${authorityReverseRoot?"(SELECT count(*) FROM public.clubs)<>2 OR (SELECT count(*) FROM public.tracker_voice_events WHERE event_kind='canonical_receipt')<>0":"EXISTS(SELECT 1 FROM public.clubs)"} THEN RAISE EXCEPTION 'wrong_authority70_fixture_database'; END IF;
 IF md5(replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'${authorityBaseline?'02fb54cede4cf42423abe72271375a8b':'f1f8d600607c96653f1ea1c0f950c119'}' THEN RAISE EXCEPTION 'authority70_state_dependency_drift'; END IF;
 ${authorityRelease71?"IF md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'16006fec6f3b9274581de471a9dc296a' THEN RAISE EXCEPTION 'release71_finish_dependency_drift'; END IF;":''}
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
 {input:`BEGIN;\n${preconditions}\n${authorityPreconditions}\nGRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated,service_role;\n${qualified}\n${fixtureOnly?'':cases}\n${fixtureOnly||authorityOverlapFixture||authorityReverseRoot?'COMMIT':'ROLLBACK'};`.replaceAll('\r\n','\n'),encoding:'utf8'});
assert.equal(result.status,0,result.stderr+(voiceBoard?'\n'+result.stdout:''));
console.log(authorityReverseRoot?'CURRENT_SCHEMA_RELEASE71_REVERSE_ROOT_READY':authorityOverlapFixture?'CURRENT_SCHEMA_RELEASE71_OVERLAP_ROOT_READY':authorityFloorFinish?'CURRENT_SCHEMA_VOICE_FLOOR_FINISH_RETRY_ROLLBACK_PASS':authorityFinish?'CURRENT_SCHEMA_VOICE_OWNER_FINISH_RETRY_ROLLBACK_PASS':authorityAction?'CURRENT_SCHEMA_VOICE70_ACTION_REPLAY_BOUNDARIES_PASS':authority70?'CURRENT_SCHEMA_VOICE70_CARD_WRAPPERS_BOUNDARIES_PASS':undo?'UNDO_GENERATION_HASH_QUEUE_REPLAY_CONFLICT_PASS':fixtureOnly?'CURRENT_SCHEMA_OVERLAP_FIXTURE_READY':voiceHoles?'CURRENT_SCHEMA_VOICE_CARD_WRAPPERS_PASS':voiceBoard?'CURRENT_SCHEMA_VOICE_BOARD_WRAPPER_PASS':'CURRENT_SCHEMA_CARD_AUTHORITY_REVISION_COMPLETION_QUEUE_PASS');
