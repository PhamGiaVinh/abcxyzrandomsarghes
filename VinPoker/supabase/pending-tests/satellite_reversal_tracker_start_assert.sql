-- Invoke inside one transaction as authenticated on the disposable E09 fixture.
-- The concurrency driver supplies the actual lease and the expected post-lock roster.
-- roster_player_id is the sole expected participant, or an empty value for no hand.
\set ON_ERROR_STOP on
SELECT set_config('test.e09_target', :'target_id', true),
       set_config('test.e09_table', :'tournament_table_id', true),
       set_config('test.e09_session', :'table_session_id', true),
       set_config('test.e09_epoch', :'control_epoch', true),
       set_config('test.e09_expected', :'expected_start', true),
       set_config('test.e09_roster_player', :'roster_player_id', true);

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  result jsonb;
  expected text := current_setting('test.e09_expected');
BEGIN
  IF expected NOT IN ('success', 'table_has_no_players') THEN
    RAISE EXCEPTION 'unexpected E09 fixture expectation: %', expected;
  END IF;

  result := public.start_tracker_hand_v3(
    current_setting('test.e09_target')::uuid,
    current_setting('test.e09_table')::uuid,
    current_setting('test.e09_session')::uuid,
    current_setting('test.e09_epoch')::bigint,
    1, NULL, auth.uid(), 1
  );
  IF expected = 'success' THEN
    IF result->>'status' IS DISTINCT FROM 'success' OR result->>'hand_id' IS NULL THEN
      RAISE EXCEPTION 'Tracker did not start the fixture hand: %', result;
    END IF;
  ELSIF result->>'error' IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Tracker did not reject the empty post-reversal roster: %', result;
  END IF;
END;
$test$;
RESET ROLE;

DO $test$
DECLARE
  target uuid := current_setting('test.e09_target')::uuid;
  participant uuid := NULLIF(current_setting('test.e09_roster_player'), '')::uuid;
  hand_count integer;
  participants uuid[];
BEGIN
  SELECT count(*) INTO hand_count
    FROM public.tournament_hands
    WHERE tournament_id = target;

  IF participant IS NULL THEN
    IF hand_count <> 0 THEN
      RAISE EXCEPTION 'empty roster still committed a Tracker hand';
    END IF;
    RETURN;
  END IF;

  SELECT array_agg(p.player_id) INTO participants
    FROM public.hand_players p
    JOIN public.tournament_hands h ON h.id = p.hand_id
    WHERE h.tournament_id = target AND h.status = 'in_progress';
  IF hand_count <> 1 OR participants IS DISTINCT FROM ARRAY[participant] THEN
    RAISE EXCEPTION 'committed Tracker hand did not use the expected roster';
  END IF;
END;
$test$;
