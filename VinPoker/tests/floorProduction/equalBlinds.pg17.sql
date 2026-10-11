\set ON_ERROR_STOP on
-- Restored current schema only; all fixture writes roll back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'equal_blinds_test: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f7270000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7270000-0000-4000-8000-000000000002','f7270000-0000-4000-8000-000000000001','Equal blinds TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7270000-0000-4000-8000-000000000003','f7270000-0000-4000-8000-000000000002','Equal blinds TEST','live','playing',1);
INSERT INTO public.tournament_levels(id,tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES
 ('f7270000-0000-4000-8000-000000000004','f7270000-0000-4000-8000-000000000003',1,100,100,0,false);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7270000-0000-4000-8000-000000000011','f7270000-0000-4000-8000-000000000002','Equal blinds TEST',71,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7270000-0000-4000-8000-000000000001',true);
DO $$ DECLARE opened jsonb; table_id uuid; session_id uuid; hand_id uuid; legacy_id uuid; revision_before bigint; repaired jsonb; BEGIN
 opened:=public.floor_open_tournament_table_v3('f7270000-0000-4000-8000-000000000003','f7270000-0000-4000-8000-000000000011','manual','f7270000-0000-4000-8000-000000000051');
 PERFORM pg_temp.assert_true((opened->>'ok')::boolean,'canonical session opens');
 table_id:=(opened->>'tournament_table_id')::uuid; session_id:=(opened->>'table_session_id')::uuid;
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=session_id;
 -- Snapshot selection is scoped to the exact session returned by open.
 INSERT INTO public.tournament_seats(tournament_id,table_id,tournament_table_id,table_session_id,seat_number,player_name,chip_count) VALUES
 ('f7270000-0000-4000-8000-000000000003',table_id,table_id,session_id,1,'A TEST',20000),
 ('f7270000-0000-4000-8000-000000000003',table_id,table_id,session_id,2,'B TEST',20000);
 INSERT INTO public.tournament_hands(tournament_id,table_id,table_session_id,hand_number,status,button_seat)
 VALUES('f7270000-0000-4000-8000-000000000003',table_id,session_id,1,'in_progress',1) RETURNING id INTO hand_id;
 PERFORM pg_temp.assert_true((SELECT tracker_small_blind=100 AND tracker_big_blind=100 AND tracker_sb_position=1 AND tracker_bb_position=2 FROM public.tournament_hands WHERE id=hand_id),'equal blinds frozen with heads-up positions');
 UPDATE public.tournament_hands SET status='completed' WHERE id=hand_id;
 PERFORM pg_temp.assert_true((SELECT q.queue_status<>'missing_blind' FROM public.get_tracker_historical_display_queue_status('f7270000-0000-4000-8000-000000000003') q WHERE q.hand_number=1),'queue recognizes complete equal-blind snapshot');
 PERFORM pg_temp.assert_true((public.get_public_tournament_table_history_v2('f7270000-0000-4000-8000-000000000003',table_id,10,NULL,NULL)->'items'->0->>'bigBlind')::integer=100,'public history retains equal-blind evidence');
 -- A complete equal-blind snapshot is immutable, not a missing-proof repair opportunity.
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 BEGIN
   PERFORM public.correct_tracker_historical_hand_blinds(hand_id,'f7270000-0000-4000-8000-000000000001',
     (SELECT source_revision FROM public.tournament_hands WHERE id=hand_id),'f7270000-0000-4000-8000-000000000004',1,100,100,0,'Equal blind regression','equal-blind-repair-test','{"test":true}');
   RAISE EXCEPTION 'complete_equal_snapshot_overwritten';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'blind_snapshot_already_present' THEN RAISE; END IF;
 END;
 -- Current-schema lineage automatically binds a session even when omitted.
 -- A manual-session historical hand genuinely has no frozen Tracker snapshot.
 UPDATE public.table_sessions SET control_mode='manual' WHERE id=session_id;
 INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number,status,button_seat)
 VALUES('f7270000-0000-4000-8000-000000000003',table_id,3,'completed',1) RETURNING id,source_revision INTO legacy_id,revision_before;
 PERFORM pg_temp.assert_true((SELECT tracker_small_blind IS NULL AND tracker_big_blind IS NULL FROM public.tournament_hands WHERE id=legacy_id),'legacy fixture actually lacks frozen blind evidence');
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=session_id;
 repaired:=public.correct_tracker_historical_hand_blinds(legacy_id,'f7270000-0000-4000-8000-000000000001',revision_before,
   'f7270000-0000-4000-8000-000000000004',1,100,100,0,'Equal blind regression','equal-blind-legacy-repair','{"test":true}');
 PERFORM pg_temp.assert_true((repaired->>'ok')::boolean AND (repaired->>'source_revision')::bigint>revision_before,'legacy missing snapshot repaired and source revision advanced');
 repaired:=public.correct_tracker_historical_hand_blinds(legacy_id,'f7270000-0000-4000-8000-000000000001',revision_before,
   'f7270000-0000-4000-8000-000000000004',1,100,100,0,'Equal blind regression','equal-blind-legacy-repair','{"test":true}');
 PERFORM pg_temp.assert_true((repaired->>'idempotent')::boolean,'legacy repair response-loss retry is idempotent');
 PERFORM pg_temp.assert_true((SELECT q.queue_status<>'missing_blind' FROM public.get_tracker_historical_display_queue_status('f7270000-0000-4000-8000-000000000003') q WHERE q.hand_number=3),'repaired equal-blind snapshot no longer classified missing');
 UPDATE public.tournament_levels SET big_blind=99 WHERE id='f7270000-0000-4000-8000-000000000004';
 BEGIN
   INSERT INTO public.tournament_hands(tournament_id,table_id,table_session_id,hand_number,status,button_seat)
   VALUES('f7270000-0000-4000-8000-000000000003',table_id,session_id,2,'in_progress',1);
   RAISE EXCEPTION 'inverted_blinds_accepted';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'tracker_floor_blind_level_unavailable' THEN RAISE; END IF;
 END;
END $$;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','floor_private.snapshot_tracker_hand_blinds()','EXECUTE') AND NOT has_function_privilege('authenticated','floor_private.snapshot_tracker_hand_blinds()','EXECUTE'),'internal snapshot ACL retained');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.correct_tracker_historical_hand_blinds(uuid,uuid,bigint,uuid,integer,bigint,bigint,bigint,text,text,jsonb)','EXECUTE'),'correction remains service only');
ROLLBACK;
