\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' THEN RAISE EXCEPTION 'wrong local database';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.floor_start_tournament_clock(uuid)'::regprocedure)<>'1cccde519b2349e9a96b56b7c64c66b7' THEN RAISE EXCEPTION 'clock definition changed';END IF;
END $$;
SET LOCAL request.jwt.claim.sub='8c9eff6f-49ac-4628-b731-87d40a9e3ff1';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"8c9eff6f-49ac-4628-b731-87d40a9e3ff1"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE tour uuid;before_state jsonb;after_state jsonb;outcome jsonb; BEGIN
 FOREACH tour IN ARRAY ARRAY['79f5b6b8-2079-4118-8268-3aab0be6341f'::uuid,'f34cd19f-933e-4a09-8227-9ec4571df289'::uuid] LOOP
  SELECT to_jsonb(t) INTO before_state FROM public.tournaments t WHERE id=tour;
  IF before_state IS NULL OR before_state->>'live_status'<>'registering' OR before_state->>'clock_started_at' IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.tournament_levels WHERE tournament_id=tour) THEN RAISE EXCEPTION 'retained schedule precondition changed';END IF;
  outcome:=public.floor_start_tournament_clock(tour);
  IF outcome->>'ok' IS DISTINCT FROM 'false' OR coalesce(outcome->>'error','') NOT IN ('no_tournament_level','invalid_tournament_level') THEN RAISE EXCEPTION 'missing-level clock guard failed: %',outcome;END IF;
  SELECT to_jsonb(t) INTO after_state FROM public.tournaments t WHERE id=tour;
  IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'denied clock start changed tournament';END IF;
  RAISE NOTICE 'SCHEDULE359_NO_LEVEL_START_DENIED_UNCHANGED % %',tour,outcome->>'error';
 END LOOP;
END $$;
ROLLBACK;
