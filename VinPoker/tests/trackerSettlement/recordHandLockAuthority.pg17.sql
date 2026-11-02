\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_card56_overlap_20261011','vinpoker_ops_finish94_unified','vinpoker_ops_finish94_ci')
  OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
  OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'finish_lock_authority_isolated_fixture_required'; END IF;
END $$;
UPDATE public.tournament_hands SET status='in_progress',is_voided=false,locked_by_user_id='81200000-0000-4000-8000-000000000001',locked_at=now()
 WHERE id='86000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE players jsonb; result jsonb; before_state jsonb; after_state jsonb;
 snapshot_sql text:=$snapshot$ SELECT jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_hands x),
 'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.player_id,x.entry_number) FROM public.hand_players x),
 'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.hand_actions x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_seats x),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_entries x),
 'chips',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tournament_id,x.player_id,x.entry_number) FROM public.tournament_chip_counts x),
 'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.hand_id,x.source_revision) FROM public.tracker_historical_display_queue x),
 'outcomes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.tournament_settlement_outcomes x)) $snapshot$;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,
 'starting_stack',starting_stack,'ending_stack',starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb))
 INTO players FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001';
 IF jsonb_array_length(players)<>2 THEN RAISE EXCEPTION 'finish_lock_fixture_roster_missing'; END IF;
 EXECUTE snapshot_sql INTO before_state;
 PERFORM set_config('role','authenticated',true);
 result:=public.record_hand('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,
 now(),players,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'81400000-0000-4000-8000-000000000001');
 IF result->>'ok'='true' THEN RAISE EXCEPTION 'TRACKER_WITHOUT_HAND_LOCK_FINISH_ACCEPTED'; END IF;
 IF result->>'error' IS NULL OR result->>'error' NOT IN ('lock_not_held','actor_not_allowed','hand_locked_by_other') THEN
  RAISE EXCEPTION 'finish_lock_unexpected_denial: %',result; END IF;
 PERFORM set_config('role','none',true);
 EXECUTE snapshot_sql INTO after_state;
 IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'finish_lock_denial_changed_state'; END IF;
 -- Positive control: the same payload and actor now owns the fixture lock.
 UPDATE public.tournament_hands SET locked_by_user_id='81400000-0000-4000-8000-000000000001',locked_at=now()
  WHERE id='86000000-0000-4000-8000-000000000001';
 PERFORM set_config('role','authenticated',true);
 result:=public.record_hand('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,
 now(),players,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'81400000-0000-4000-8000-000000000001');
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'finish_lock_owner_control_failed: %',result; END IF;
 PERFORM set_config('role','none',true);
 IF NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=(result->>'hand_id')::uuid AND status='completed' AND locked_by_user_id IS NULL) THEN
  RAISE EXCEPTION 'finish_lock_positive_postcondition_failed'; END IF;
END $$;
ROLLBACK;
\echo RECORD_HAND_OTHER_LOCK_DENIED_OWN_LOCK_POSITIVE_PASS
