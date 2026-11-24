\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  ASSERT current_database() = 'tracker_bba349_current';
  ASSERT inet_server_port() = 55519 AND host(inet_server_addr()) = '127.0.0.1';
END $$;

CREATE FUNCTION public.test_fail_bb_ante349() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action_type = 'post_bb' AND current_setting('tracker_test.fail_hand', true) = NEW.hand_id::text THEN
    RAISE EXCEPTION 'injected_bb_failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_test_fail_bb_ante349 BEFORE INSERT ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION public.test_fail_bb_ante349();

DO $test$
DECLARE
  actor uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  club uuid := gen_random_uuid();
  tour uuid := gen_random_uuid();
  table_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  level_id uuid := gen_random_uuid();
  sb uuid := gen_random_uuid();
  bb uuid := gen_random_uuid();
  hand uuid;
  answer jsonb;
  repeated jsonb;
  case_index integer;
  bb_stack integer;
  expected_bb integer;
  expected_ante integer;
BEGIN
  INSERT INTO auth.users(id) VALUES(actor),(outsider);
  INSERT INTO public.clubs(id, owner_id) VALUES(club, actor);
  INSERT INTO public.tournaments(id, club_id, name, status, current_level_id, current_level)
  VALUES(tour, club, 'BB ante isolated TEST', 'active', level_id, 1);
  INSERT INTO public.tournament_levels(id, tournament_id, level_number, small_blind, big_blind, ante, is_break)
  VALUES(level_id, tour, 1, 100, 200, 0, false);
  INSERT INTO public.table_sessions(id, tournament_id, control_mode) VALUES(session_id, tour, 'tracker');
  INSERT INTO public.tournament_seats(id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status)
  VALUES(gen_random_uuid(),tour,sb,1,table_id,1,1000,true,'active'),
        (gen_random_uuid(),tour,bb,1,table_id,2,1000,true,'active');

  ASSERT NOT has_function_privilege('anon', 'public.post_tracker_blinds_v1(uuid,uuid)', 'EXECUTE');
  ASSERT NOT has_table_privilege('authenticated', 'floor_private.tracker_blind_receipts350', 'INSERT');
  FOR case_index IN 1..4 LOOP
    bb_stack := (ARRAY[1000,300,100,0])[case_index];
    expected_bb := least(200, bb_stack);
    expected_ante := least(200, bb_stack - expected_bb);
    INSERT INTO public.tournament_hands(tournament_id, table_id, table_session_id, hand_number,
      status, created_by, locked_by_user_id, locked_at, button_seat)
    VALUES(tour, table_id, session_id, case_index, 'in_progress', actor, actor, now(), 1)
    RETURNING id INTO hand;
    ASSERT (SELECT tracker_bba = 200 AND tracker_big_blind_ante_only FROM public.tournament_hands WHERE id = hand),
      'new hand must freeze 200 ante even when structure ante is zero';
    INSERT INTO public.hand_players(hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack)
    VALUES(hand,tour,sb,1,1,1000),(hand,tour,bb,1,2,bb_stack);

    PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      PERFORM public.post_tracker_blinds_v1(hand, gen_random_uuid());
      RAISE EXCEPTION 'outsider unexpectedly posted blinds';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'actor_not_allowed', SQLERRM;
    END;
    PERFORM set_config('role', 'none', true);
    ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id = hand);

    PERFORM set_config('request.jwt.claim.sub', actor::text, true);
    PERFORM set_config('role', 'authenticated', true);
    answer := public.post_tracker_blinds_v1(hand, gen_random_uuid());
    repeated := public.post_tracker_blinds_v1(hand, gen_random_uuid());
    PERFORM set_config('role', 'none', true);
    ASSERT answer->>'status' = 'success', answer::text;
    ASSERT (answer->>'bb_paid')::integer = expected_bb, answer::text;
    ASSERT (answer->>'ante_paid')::integer = expected_ante, answer::text;
    ASSERT repeated->>'duplicate' = 'true', repeated::text;
    ASSERT (SELECT count(*) FROM public.hand_actions WHERE hand_id = hand) = CASE WHEN expected_ante > 0 THEN 3 ELSE 2 END;
    ASSERT (SELECT sum(action_amount) FROM public.hand_actions WHERE hand_id = hand) = 100 + expected_bb + expected_ante;
    ASSERT (SELECT count(*) FROM floor_private.tracker_blind_receipts350 WHERE hand_id = hand) = 1;
    BEGIN
      UPDATE public.tournament_hands SET tracker_big_blind_ante_only = false WHERE id = hand;
      RAISE EXCEPTION 'frozen rule was changed';
    EXCEPTION WHEN raise_exception THEN
      ASSERT SQLERRM = 'tracker_ante_rule_immutable', SQLERRM;
    END;
    ASSERT (SELECT jsonb_agg(action_type ORDER BY action_order) FROM public.hand_actions WHERE hand_id = hand)
      = CASE WHEN expected_ante > 0 THEN '["post_sb","post_ante","post_bb"]'::jsonb ELSE '["post_sb","post_bb"]'::jsonb END;
  END LOOP;

  INSERT INTO public.tournament_hands(tournament_id, table_id, table_session_id, hand_number,
    status, created_by, locked_by_user_id, locked_at, button_seat)
  VALUES(tour, table_id, session_id, 5, 'in_progress', actor, actor, now(), 1) RETURNING id INTO hand;
  INSERT INTO public.hand_players(hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack)
  VALUES(hand,tour,sb,1,1,1000),(hand,tour,bb,1,2,1000);
  INSERT INTO public.club_trackers(club_id, user_id) VALUES(club, outsider);
  PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.post_tracker_blinds_v1(hand, gen_random_uuid());
    RAISE EXCEPTION 'another tracker bypassed the hand lock';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'tracker_blinds_lock_required', SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', actor::text, true);
  UPDATE public.tournament_hands SET locked_at = now() - interval '1 day' WHERE id = hand;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.post_tracker_blinds_v1(hand, gen_random_uuid());
    RAISE EXCEPTION 'expired lock accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'tracker_blinds_lock_required', SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  UPDATE public.tournament_hands SET locked_at = now() WHERE id = hand;
  UPDATE public.table_sessions SET closed_at = clock_timestamp() WHERE id = session_id;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.post_tracker_blinds_v1(hand, gen_random_uuid());
    RAISE EXCEPTION 'closed session accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'tracker_blinds_session_unavailable', SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  UPDATE public.table_sessions SET closed_at = NULL WHERE id = session_id;
  PERFORM set_config('tracker_test.fail_hand', hand::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.record_action(hand, sb, 'post_sb', 1, 1, 'preflop', 100);
    RAISE EXCEPTION 'individual blind bypassed the batch';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'tracker_blinds_atomic_batch_required', SQLERRM;
  END;
  BEGIN
    PERFORM public.record_action(hand, sb, 'check', 1, 1, 'preflop', 0);
    RAISE EXCEPTION 'betting started without blind receipt';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'tracker_blinds_not_confirmed', SQLERRM;
  END;
  BEGIN
    PERFORM public.post_tracker_blinds_v1(hand, gen_random_uuid());
    RAISE EXCEPTION 'injected failure did not abort';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'injected_bb_failure', SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id = hand), 'partial SB/ante writes survived';
  ASSERT NOT EXISTS(SELECT 1 FROM floor_private.tracker_blind_receipts350 WHERE hand_id = hand);
  ASSERT current_setting('vinpoker.blind_batch_hand', true) IS DISTINCT FROM hand::text;

  -- Rehearse the existing dead-SB frozen-position case with two remaining players.
  INSERT INTO public.tournament_hands(tournament_id, table_id, table_session_id, hand_number,
    status, created_by, locked_by_user_id, locked_at, button_seat)
  VALUES(tour, table_id, session_id, 6, 'in_progress', actor, actor, now(), 1) RETURNING id INTO hand;
  UPDATE public.tournament_hands SET tracker_sb_position = 10 WHERE id = hand;
  INSERT INTO public.hand_players(hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack)
  VALUES(hand,tour,sb,1,3,1000),(hand,tour,bb,1,2,1000);
  PERFORM set_config('role', 'authenticated', true);
  answer := public.post_tracker_blinds_v1(hand, gen_random_uuid());
  PERFORM set_config('role', 'none', true);
  ASSERT answer->>'sb_paid' = '0' AND answer->>'bb_paid' = '200' AND answer->>'ante_paid' = '200', answer::text;
  ASSERT (SELECT jsonb_agg(action_type ORDER BY action_order) FROM public.hand_actions WHERE hand_id = hand)
    = '["post_ante","post_bb"]'::jsonb;

  -- A pre-existing frozen rule keeps the legacy posting path and zero ante.
  INSERT INTO public.tournament_hands(tournament_id, table_id, hand_number,
    status, created_by, locked_by_user_id, locked_at, button_seat,
    tracker_level_number, tracker_small_blind, tracker_big_blind, tracker_bba)
  VALUES(tour, table_id, 7, 'in_progress', actor, actor, now(), 1, 1, 100, 200, 0) RETURNING id INTO hand;
  UPDATE public.tournament_hands SET table_session_id = session_id WHERE id = hand;
  INSERT INTO public.hand_players(hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack)
  VALUES(hand,tour,sb,1,1,1000),(hand,tour,bb,1,2,1000);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.post_tracker_blinds_v1(hand, gen_random_uuid());
    RAISE EXCEPTION 'old frozen rule was replaced';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'tracker_blinds_hand_rule_unavailable', SQLERRM;
  END;
  answer := public.record_action(hand, sb, 'post_sb', 1, 1, 'preflop', 100);
  ASSERT answer->>'status' = 'success', answer::text;
  answer := public.record_action(hand, bb, 'post_bb', 2, 1, 'preflop', 200);
  ASSERT answer->>'status' = 'success', answer::text;
  PERFORM set_config('role', 'none', true);
  ASSERT (SELECT NOT tracker_big_blind_ante_only AND tracker_bba = 0 FROM public.tournament_hands WHERE id = hand);
  ASSERT (SELECT sum(action_amount) FROM public.hand_actions WHERE hand_id = hand) = 300;
  RAISE NOTICE 'BB_ANTE_ATOMIC_LOCAL_PASS: freeze, full/short/zero stacks, duplicate, outsider, rollback';
END;
$test$;
ROLLBACK;
