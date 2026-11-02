\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local369_only';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='ce2e4ef8-7c36-4f01-9e93-efcfd5464dc9' AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c' AND player_id='ae7aa446-f5ee-408a-98d0-a198632080b0' AND status='busted') THEN RAISE EXCEPTION 'reentry369_fixture_drift';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_registrations WHERE source_entry_id='ce2e4ef8-7c36-4f01-9e93-efcfd5464dc9' AND status IN ('pending','confirmed')) THEN RAISE EXCEPTION 'reentry369_existing_request_do_not_recreate';END IF;
END $$;
SAVEPOINT open_window369;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE result jsonb;replay jsonb;before_count bigint;before_cash bigint;before_entries bigint; BEGIN
 SELECT count(*) INTO before_count FROM public.tournament_registrations WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
 SELECT count(*) INTO before_cash FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
 SELECT count(*) INTO before_entries FROM public.tournament_entries WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
 result:=public.cashier_create_app_reentry_v1('46cab483-91e7-4220-aacf-e17bdf05269c','ae7aa446-f5ee-408a-98d0-a198632080b0');
 IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'status' IS DISTINCT FROM 'pending'
  OR (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c')<>before_count+1
  OR (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c')<>before_cash
  OR (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c')<>before_entries THEN RAISE EXCEPTION 'reentry369_open_window_regression';END IF;
 replay:=public.cashier_create_app_reentry_v1('46cab483-91e7-4220-aacf-e17bdf05269c','ae7aa446-f5ee-408a-98d0-a198632080b0');
 IF replay->>'registration_id' IS DISTINCT FROM result->>'registration_id' OR replay->>'already_registered' IS DISTINCT FROM 'true'
  OR replay->'price_snapshot' IS DISTINCT FROM result->'price_snapshot'
  OR (SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c')<>before_count+1 THEN RAISE EXCEPTION 'reentry370_pending_replay_regression';END IF;
 UPDATE public.tournaments SET registration_closed_at=now() WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c';
 replay:=public.cashier_create_app_reentry_v1('46cab483-91e7-4220-aacf-e17bdf05269c','ae7aa446-f5ee-408a-98d0-a198632080b0');
 IF replay->>'error' IS DISTINCT FROM 'reentry_window_closed' THEN RAISE EXCEPTION 'reentry370_pending_after_close_not_fenced';END IF;
 RAISE NOTICE 'REENTRY369_OPEN_PENDING_NO_CASH_OR_ENTRY_PASS';
END $$;
ROLLBACK TO open_window369;
UPDATE public.tournaments SET registration_closed_at=now() WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c';
DO $$ BEGIN IF public.is_tournament_registration_closed('46cab483-91e7-4220-aacf-e17bdf05269c') IS NOT TRUE THEN RAISE EXCEPTION 'close_marker369_not_active';END IF;END $$;
CREATE TEMP TABLE reentry369_before AS SELECT count(*) count FROM public.tournament_registrations WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
CREATE TEMP TABLE reentry369_result(value jsonb);
GRANT INSERT ON reentry369_result TO service_role;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO reentry369_result SELECT public.cashier_create_app_reentry_v1('46cab483-91e7-4220-aacf-e17bdf05269c','ae7aa446-f5ee-408a-98d0-a198632080b0');
RESET ROLE;
DO $$ DECLARE result jsonb;before_count bigint;after_count bigint; BEGIN
 SELECT count INTO before_count FROM reentry369_before;
 SELECT value INTO result FROM reentry369_result;
 SELECT count(*) INTO after_count FROM public.tournament_registrations WHERE tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c';
 RAISE NOTICE 'REENTRY369_OBSERVED ok=% error=% row_delta=%',result->>'ok',result->>'error',after_count-before_count;
 IF result->>'ok' IS DISTINCT FROM 'false' OR result->>'error' IS DISTINCT FROM 'reentry_window_closed' OR after_count<>before_count THEN RAISE EXCEPTION 'REENTRY369_CLOSED_REGISTRATION_NOT_FENCED';END IF;
END $$;
SAVEPOINT finished370;
UPDATE public.tournaments SET registration_closed_at=NULL,live_status='finished' WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c';
DO $$ DECLARE result jsonb; BEGIN
 result:=public.cashier_create_app_reentry_v1('46cab483-91e7-4220-aacf-e17bdf05269c','ae7aa446-f5ee-408a-98d0-a198632080b0');
 IF result->>'error' IS DISTINCT FROM 'reentry_window_closed' THEN RAISE EXCEPTION 'reentry370_finished_not_fenced';END IF;
 RAISE NOTICE 'REENTRY370_FINISHED_MARKER_DENIED_PASS';
END $$;
ROLLBACK TO finished370;
ROLLBACK;
