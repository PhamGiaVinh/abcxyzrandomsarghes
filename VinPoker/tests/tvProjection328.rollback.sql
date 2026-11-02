\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$
DECLARE a uuid:='782a5196-5ea1-44ed-8a27-1b872d5f88d9';b uuid:='fdf91018-09f3-4cdc-b76a-f688eb216cee';
 before_b jsonb;after_b jsonb;after_a jsonb;duration integer;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local328_only';END IF;
 IF (SELECT count(*) FROM public.tournaments WHERE id IN(a,b) AND event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND phase='flight')<>2 THEN RAISE EXCEPTION 'flight328_identity_drift';END IF;
 IF NOT has_function_privilege('anon','public.get_public_tournament_clock_summary(uuid)','EXECUTE') THEN RAISE EXCEPTION 'anonymous328_grant_missing';END IF;
 SELECT to_jsonb(s) INTO before_b FROM public.get_public_tournament_clock_summary(b) s;
 IF before_b->>'is_running'<>'false' THEN RAISE EXCEPTION 'retained328_clock_running_do_not_mutate';END IF;
 SELECT l.duration_minutes INTO duration FROM public.tournament_levels l JOIN public.tournaments t ON t.id=l.tournament_id AND l.level_number=t.current_level WHERE t.id=a;
 IF duration IS NULL THEN RAISE EXCEPTION 'flight328_level_missing';END IF;
 UPDATE public.tournaments SET clock_started_at='2026-10-21T00:00:00Z',clock_paused_at='2026-10-21T00:00:37Z',pause_accumulated=0 WHERE id=a;
 SELECT to_jsonb(s) INTO after_a FROM public.get_public_tournament_clock_summary(a) s;
 SELECT to_jsonb(s) INTO after_b FROM public.get_public_tournament_clock_summary(b) s;
 IF before_b IS DISTINCT FROM after_b THEN RAISE EXCEPTION 'flightB328_changed_by_flightA';END IF;
 IF after_a->>'tournament_id'<>a::text OR (after_a->>'remaining_seconds')::integer<>greatest(duration*60-37,0) OR after_a->>'is_running'<>'false' THEN RAISE EXCEPTION 'flightA328_clock_projection_wrong';END IF;
 IF after_a->>'entries'<>'8' OR after_a->>'players_remaining'<>'0' THEN RAISE EXCEPTION 'flight328_participation_projection_drift';END IF;
END $$;
SET LOCAL ROLE anon;
SELECT jsonb_build_object('flightA',a.tournament_id,'remaining',a.remaining_seconds,'entries',a.entries,'remainingPlayers',a.players_remaining)
 FROM public.get_public_tournament_clock_summary('782a5196-5ea1-44ed-8a27-1b872d5f88d9') a;
SELECT 'TV328_NATIVE_FLIGHT_CLOCK_ISOLATION_ANON_ROLLBACK_PASS';
ROLLBACK;
