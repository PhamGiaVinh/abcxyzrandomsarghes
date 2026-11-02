\set ON_ERROR_STOP on
-- Expected RED until a session/epoch-bound manual Finish intent replaces bare record_hand.
BEGIN;
\if :{?LEGACY_FINISH_RETIRED}
SELECT set_config('vinpoker.test_finish_retired','true',true);
\else
SELECT set_config('vinpoker.test_finish_retired','false',true);
\endif
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_finish94_unified','vinpoker_ops_finish96_qualified','vinpoker_ops_finish96_ci') OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'finish_epoch_isolated_fixture_required'; END IF;
END $$;
UPDATE public.tournament_hands SET status='in_progress',is_voided=false,
 locked_by_user_id='81400000-0000-4000-8000-000000000001',locked_at=now()
 WHERE id='86000000-0000-4000-8000-000000000001';
-- Model a controller-generation invalidation after the client built its intent.
-- This fixture update is not a claim that a particular public lifecycle RPC did it.
SELECT set_config('vinpoker.test_finish_expected_epoch',(SELECT control_epoch::text FROM public.table_sessions
 WHERE id='83500000-0000-4000-8000-000000000001'),true);
UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id='83500000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','81400000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"81400000-0000-4000-8000-000000000001"}',true);
DO $$ DECLARE players jsonb; result jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001'
  AND control_epoch=current_setting('vinpoker.test_finish_expected_epoch')::bigint+1) THEN
  RAISE EXCEPTION 'finish_epoch_invalidation_not_executed'; END IF;
 SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'seat_number',seat_number,
 'starting_stack',starting_stack,'ending_stack',starting_stack,'is_eliminated',false,'hole_cards','[]'::jsonb))
 INTO players FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001';
 PERFORM set_config('role','authenticated',true);
 result:=public.record_hand('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,
 now(),players,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'81400000-0000-4000-8000-000000000001');
 IF result->>'ok'='true' THEN RAISE EXCEPTION 'STALE_CONTROLLER_EPOCH_MANUAL_FINISH_ACCEPTED'; END IF;
 RAISE EXCEPTION 'finish_epoch_unexpected_denial: %',result;
EXCEPTION WHEN insufficient_privilege THEN
 IF current_setting('vinpoker.test_finish_retired')<>'true' THEN RAISE; END IF;
END $$;
ROLLBACK;
\echo BARE_MANUAL_FINISH_RETIRED_PERMISSION_DENIAL_PASS
