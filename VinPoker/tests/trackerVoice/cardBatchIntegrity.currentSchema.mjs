import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

assert.equal(process.env.PGHOST,'127.0.0.1');
const fixtureOnly=process.argv.includes('--fixture-only');
const undo=process.argv.includes('--undo');
if(undo){
 assert.equal(process.env.PGPORT,'55441');
 assert.equal(process.env.PGUSER,'postgres');
 for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.ok(!process.env[key],`${key} override forbidden for undo fixture`);
}
const voiceHoles=process.argv.includes('--voice-holes');
const voiceBoard=process.argv.includes('--voice-board')||voiceHoles;
assert.ok(!(fixtureOnly&&voiceBoard));
assert.ok(!(undo&&(fixtureOnly||voiceBoard)));
assert.equal(process.env.PGDATABASE,undo?'vinpoker_ops_undo_generation_20261011':fixtureOnly?'vinpoker_ops_card56_overlap_20261011':'vinpoker_ops_card56_20261011');
// Reuse existing Voice identities/session fixture, with real schema-required
// club names. No helper replacement, trigger disable, or role elevation.
const fixture=readFileSync('tests/trackerVoice/disposableDb.integration.sql','utf8');
assert.ok(fixture.indexOf('INSERT INTO public.tracker_voice_configs')>fixture.indexOf('INSERT INTO public.hand_players('),'fixture boundary must follow initial hand roster');
let prefix=fixture.slice(0,fixture.indexOf('INSERT INTO public.tracker_voice_configs'))
 .replace('public.clubs(id, owner_id)','public.clubs(id, owner_id, name, region)')
 .replace("('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001','Card integrity TEST','TEST')")
 .replace("('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001','Foreign card TEST','TEST')")
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
const qualified=prefix.replace('INSERT INTO public.tournament_hands(',
 readFileSync('tests/trackerVoice/cardBatchIntegrity.roster.sql','utf8')+'\nINSERT INTO public.tournament_hands(');
const configStart=fixture.indexOf('INSERT INTO public.tracker_voice_configs');
const configEnd=fixture.indexOf('-- Production repair shape:');
assert.ok(configEnd>configStart);
const dependencies=readFileSync('tests/trackerVoice/disposableDb.dependencies.sql','utf8');
const assertStart=dependencies.indexOf('CREATE OR REPLACE FUNCTION public.tracker_voice_test_assert(');
const assertEnd=dependencies.indexOf("SELECT 'TRACKER_VOICE_DEPENDENCIES_READY'");
assert.ok(assertStart>=0&&assertEnd>assertStart);
const cases=undo?readFileSync('tests/trackerCorrectionRelease2/undoGeneration.currentSchema.sql','utf8'):voiceBoard?dependencies.slice(assertStart,assertEnd)+fixture.slice(configStart,configEnd)+
 "\nINSERT INTO public.app_settings(key,value) VALUES('tracker_voice_global_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;\n"+
 readFileSync('tests/trackerVoice/boardAssist.integration.sql','utf8').replaceAll('81200000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001').replace(
  'SELECT public.tracker_voice_test_assert(',"\\echo :board_root_flop_payload\nSELECT public.tracker_voice_test_assert(")+
 (voiceHoles?"\nINSERT INTO public.hand_actions(hand_id,player_id,entry_number,street,action_type,action_amount,action_order) VALUES('86000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',1,'preflop','call',100,1);\n"+
 readFileSync('tests/trackerVoice/holeCardsAssist.integration.sql','utf8').replaceAll('81200000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001'):''):
 readFileSync('tests/trackerVoice/cardBatchIntegrity.currentSchema.cases.sql','utf8');
const preconditions=undo?`DO $$ BEGIN
 IF inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55441 OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'wrong_undo_server'; END IF;
 IF current_database()<>'vinpoker_ops_undo_generation_20261011' OR EXISTS(SELECT 1 FROM public.clubs) THEN RAISE EXCEPTION 'wrong_or_nonempty_undo_database'; END IF;
 IF md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '273b34a53a9114af87d9d8bc940dce38'
 OR md5(replace(pg_get_functiondef('public.delete_last_action(uuid,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM '37573f5c4a9c013bf8e7573767036d9f' THEN RAISE EXCEPTION 'undo_dependency_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision' AND tgenabled='O' AND md5(replace(pg_get_functiondef(tgfoid),chr(13),''))='14f9e44a3b7847753f36efc365b5b208') THEN RAISE EXCEPTION 'revision_trigger_drift: %',(SELECT jsonb_build_object('function',tgfoid::regprocedure::text,'enabled',tgenabled,'digest',md5(replace(pg_get_functiondef(tgfoid),chr(13),''))) FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgname='trg_tracker_hand_source_revision'); END IF;
END $$;`:'';
const result=spawnSync('psql',['-X','-w','-v','ON_ERROR_STOP=1'],
 // Public-only capture omits managed auth schema grants. Read-only live
 // privilege checks verified these three roles have USAGE and uid/jwt EXECUTE.
 // Mirror only in this rollback transaction; no public table grants or bypass.
 {input:`BEGIN;\n${preconditions}\nGRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated,service_role;\n${qualified}\n${fixtureOnly?'':cases}\n${fixtureOnly?'COMMIT':'ROLLBACK'};`,encoding:'utf8'});
assert.equal(result.status,0,result.stderr+(voiceBoard?'\n'+result.stdout:''));
console.log(undo?'UNDO_GENERATION_HASH_QUEUE_REPLAY_CONFLICT_PASS':fixtureOnly?'CURRENT_SCHEMA_OVERLAP_FIXTURE_READY':voiceHoles?'CURRENT_SCHEMA_VOICE_CARD_WRAPPERS_PASS':voiceBoard?'CURRENT_SCHEMA_VOICE_BOARD_WRAPPER_PASS':'CURRENT_SCHEMA_CARD_AUTHORITY_REVISION_COMPLETION_QUEUE_PASS');
