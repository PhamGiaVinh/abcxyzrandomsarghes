-- Pending, disposable G03 proof only.
-- Restore the previously observed op_start_hand definition to roll back while disabled and idle.
DO $$
BEGIN
  IF public.op_is_enabled() OR EXISTS (
    SELECT 1 FROM public.online_poker_hands WHERE status IN ('dealing','betting')
  ) THEN
    RAISE EXCEPTION 'online poker must be disabled and idle';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid =
    to_regprocedure('public.op_start_hand(jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone,uuid)'))
      IS DISTINCT FROM '10282a2bb252d87125652c048de5d502' THEN
    RAISE EXCEPTION 'unexpected op_start_hand baseline';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.op_start_hand(
  p_state          jsonb,
  p_deck           jsonb,
  p_board_future   jsonb,
  p_holes          jsonb,
  p_events         jsonb,
  p_engine_version text,
  p_act_deadline   timestamptz,
  p_actor_user_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hand_id   uuid := (p_state->'config'->>'handId')::uuid;
  v_table_id  uuid := (p_state->'config'->>'tableId')::uuid;
  v_hand_no   bigint := (p_state->'config'->>'handNo')::bigint;
  v_button    int := (p_state->'config'->>'buttonSeat')::int;
  v_schema_v  int := (p_state->'config'->>'schemaVersion')::int;
  v_table public.online_poker_tables%ROWTYPE;
  v_terminal boolean := COALESCE(p_state->>'status' = 'complete', false);
  v_expected bigint;
  v_funded_count int;
  v_hand_count int;
  v_updated_count int;
  v_initial numeric;
  v_final numeric;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  -- Public state must never carry secret data.
  IF p_state ? 'deck'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'seats') s WHERE s ? 'holeCards') THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'public state carries secret data');
  END IF;

  IF v_terminal THEN
    -- Seat writers may close the table after releasing the last seat.
    -- Acquire seat locks before the table row to follow the same order.
    PERFORM 1 FROM public.online_poker_seats
    WHERE table_id = v_table_id ORDER BY seat_no FOR UPDATE;
    SELECT * INTO v_table FROM public.online_poker_tables WHERE id = v_table_id FOR SHARE;
    IF NOT FOUND OR v_table.status <> 'open'
       OR v_table.sb IS DISTINCT FROM (p_state->'config'->>'sb')::bigint
       OR v_table.bb IS DISTINCT FROM (p_state->'config'->>'bb')::bigint THEN
      RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'stale table configuration');
    END IF;
    SELECT COALESCE(MAX(hand_no), 0) + 1 INTO v_expected
    FROM public.online_poker_hands WHERE table_id = v_table_id;
    IF v_hand_no IS DISTINCT FROM v_expected THEN
      RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'stale hand sequence');
    END IF;
  END IF;

  -- One active hand per table (the partial unique index is the hard backstop).
  IF EXISTS (SELECT 1 FROM public.online_poker_hands
             WHERE table_id = v_table_id AND status IN ('dealing', 'betting')) THEN
    RETURN jsonb_build_object('outcome', 'already_active');
  END IF;

  INSERT INTO public.online_poker_hands (
    id, table_id, hand_no, state_version, state_schema_version, engine_version,
    button_seat, street, board, pot, side_pots, to_act_seat, act_deadline, status, state
  ) VALUES (
    v_hand_id, v_table_id, v_hand_no, 0, v_schema_v, p_engine_version,
    v_button, p_state->>'street', COALESCE(p_state->'board', '[]'::jsonb),
    (p_state->>'pot')::bigint, COALESCE(p_state->'sidePots', '[]'::jsonb),
    (p_state->>'toAct')::int, p_act_deadline, p_state->>'status', p_state
  );

  -- Per-seat public facts (in-hand seats only).
  INSERT INTO public.online_poker_hand_seats (
    hand_id, seat_no, user_id, starting_stack, stack, committed, total_committed, status, revealed_cards
  )
  SELECT v_hand_id, (s->>'seat')::int, (s->>'playerId')::uuid,
         (s->>'startingStack')::bigint, (s->>'stack')::bigint,
         (s->>'committed')::bigint, (s->>'totalCommitted')::bigint,
         s->>'status',
         CASE WHEN s ? 'revealedCards' THEN s->'revealedCards' ELSE NULL END
  FROM jsonb_array_elements(p_state->'seats') AS s
  WHERE (s->>'status') IN ('active', 'folded', 'allin');

  IF v_terminal THEN
    SELECT count(*), sum(starting_stack), sum(stack) INTO v_hand_count, v_initial, v_final
    FROM public.online_poker_hand_seats WHERE hand_id = v_hand_id;
    SELECT count(*) INTO v_funded_count FROM public.online_poker_seats
    WHERE table_id = v_table_id AND status = 'sitting' AND stack > 0;
    IF v_hand_count < 2 OR v_hand_count <> v_funded_count
       OR (p_state->>'pot')::bigint IS DISTINCT FROM 0::bigint
       OR v_initial IS DISTINCT FROM v_final THEN
      RAISE EXCEPTION 'online_poker_invalid_terminal_stacks' USING ERRCODE = '23514';
    END IF;

    UPDATE public.online_poker_seats s SET stack = hs.stack
    FROM public.online_poker_hand_seats hs
    WHERE hs.hand_id = v_hand_id AND s.table_id = v_table_id
      AND s.seat_no = hs.seat_no AND s.user_id = hs.user_id
      AND s.status = 'sitting' AND s.stack > 0 AND s.stack = hs.starting_stack;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> v_hand_count THEN
      RAISE EXCEPTION 'online_poker_stale_terminal_seats' USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Secrets: original deck (immutable / audit), live deck (resume), per-seat holes.
  INSERT INTO public.online_poker_hand_secrets (hand_id, kind, seat_no, cards) VALUES
    (v_hand_id, 'deck', NULL, p_deck),
    (v_hand_id, 'board_future', NULL, p_board_future);
  INSERT INTO public.online_poker_hand_secrets (hand_id, kind, seat_no, cards)
  SELECT v_hand_id, 'hole', (h->>'seat')::int, h->'cards'
  FROM jsonb_array_elements(p_holes) AS h;

  -- Initial events. The RPC is the single owner of per-hand seq: assign it from
  -- array order (the Edge passes {type, payload} only).
  INSERT INTO public.online_poker_hand_events (hand_id, event_seq, type, payload)
  SELECT v_hand_id, (t.ord - 1)::int, t.e->>'type', COALESCE(t.e->'payload', '{}'::jsonb)
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, ord);

  RETURN jsonb_build_object('outcome', 'ok', 'hand_id', v_hand_id, 'state_version', 0);
END;
$$;
