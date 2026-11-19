-- Pending G03, isolated evidence only. No wallet update, hand repair or backfill.
-- Rollback requires an idle runtime. Remove the three triggers, then their functions.
DO $$
BEGIN
  IF public.op_is_enabled() OR EXISTS (
    SELECT 1 FROM public.online_poker_hands WHERE status IN ('dealing', 'betting')
  ) THEN
    RAISE EXCEPTION 'online poker runtime must be disabled and idle for this migration';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.op_verify_hand_start_stacks()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  expected_hand_no bigint;
  seat_count int;
  matching_count int;
BEGIN
  -- Keep the previous-hand counter and table settings stable across concurrent starts.
  PERFORM 1 FROM public.online_poker_tables WHERE id = NEW.table_id FOR UPDATE;
  SELECT COALESCE(MAX(hand_no), 0) + 1 INTO expected_hand_no
  FROM public.online_poker_hands WHERE table_id = NEW.table_id;
  IF NEW.hand_no IS DISTINCT FROM expected_hand_no THEN
    RAISE EXCEPTION 'online_poker_stale_hand_sequence' USING ERRCODE = '40001';
  END IF;
  -- Take seat locks in canonical order before checking the captured inputs.
  PERFORM 1 FROM public.online_poker_seats
  WHERE table_id = NEW.table_id ORDER BY seat_no FOR UPDATE;
  SELECT count(*), count(DISTINCT s.seat_no) INTO seat_count, matching_count
  FROM jsonb_array_elements(NEW.state->'seats') AS p(value)
  LEFT JOIN public.online_poker_seats s ON s.table_id = NEW.table_id
    AND s.seat_no = (p.value->>'seat')::int
    AND s.user_id = (p.value->>'playerId')::uuid
    AND s.stack = (p.value->>'startingStack')::bigint
    AND s.status = 'sitting' AND s.stack > 0
  WHERE p.value->>'status' IN ('active', 'folded', 'allin');
  IF seat_count < 2 OR seat_count <> matching_count THEN
    RAISE EXCEPTION 'online_poker_stale_seat_stacks' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.op_protect_in_hand_seat_stacks()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (OLD.table_id, OLD.seat_no, OLD.user_id, OLD.stack, OLD.status)
       IS NOT DISTINCT FROM (NEW.table_id, NEW.seat_no, NEW.user_id, NEW.stack, NEW.status) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.online_poker_hands h
    JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
    WHERE h.table_id = OLD.table_id AND h.status IN ('dealing', 'betting')
      AND hs.seat_no = OLD.seat_no AND hs.user_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'online_poker_seat_in_active_hand' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.op_carry_terminal_hand_stacks()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  expected_count int;
  final_count int;
  updated_count int;
  starting_total numeric;
  final_total numeric;
BEGIN
  IF NEW.status <> 'complete' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('dealing', 'betting') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT count(*), sum(starting_stack) INTO expected_count, starting_total
    FROM public.online_poker_hand_seats WHERE hand_id = NEW.id;
  ELSE
    SELECT count(*), sum((p.value->>'startingStack')::bigint) INTO expected_count, starting_total
    FROM jsonb_array_elements(NEW.state->'seats') AS p(value)
    WHERE p.value->>'status' IN ('active', 'folded', 'allin');
  END IF;
  SELECT count(*), sum((p.value->>'stack')::bigint) INTO final_count, final_total
  FROM jsonb_array_elements(NEW.state->'seats') AS p(value)
  WHERE p.value->>'status' IN ('active', 'folded', 'allin');
  IF expected_count < 2 OR final_count <> expected_count OR final_total IS DISTINCT FROM starting_total OR NEW.pot <> 0 THEN
    RAISE EXCEPTION 'online_poker_terminal_stack_conservation_failed' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.online_poker_seats
  WHERE table_id = NEW.table_id ORDER BY seat_no FOR UPDATE;
  UPDATE public.online_poker_seats s
  SET stack = (p.value->>'stack')::bigint
  FROM jsonb_array_elements(NEW.state->'seats') AS p(value)
  WHERE p.value->>'status' IN ('active', 'folded', 'allin')
    AND s.table_id = NEW.table_id AND s.status = 'sitting'
    AND s.seat_no = (p.value->>'seat')::int AND s.user_id = (p.value->>'playerId')::uuid
    AND s.stack = (p.value->>'startingStack')::bigint
    AND (TG_OP = 'INSERT' OR EXISTS (
      SELECT 1 FROM public.online_poker_hand_seats hs
      WHERE hs.hand_id = NEW.id AND hs.seat_no = s.seat_no AND hs.user_id = s.user_id
        AND hs.starting_stack = s.stack
    ));
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'online_poker_terminal_seat_scope_mismatch' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.op_verify_hand_start_stacks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.op_protect_in_hand_seat_stacks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.op_carry_terminal_hand_stacks() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_op_verify_hand_start_stacks ON public.online_poker_hands;
CREATE TRIGGER trg_op_verify_hand_start_stacks BEFORE INSERT ON public.online_poker_hands
FOR EACH ROW EXECUTE FUNCTION public.op_verify_hand_start_stacks();

DROP TRIGGER IF EXISTS trg_op_protect_in_hand_seat_stacks ON public.online_poker_seats;
CREATE TRIGGER trg_op_protect_in_hand_seat_stacks BEFORE UPDATE OR DELETE ON public.online_poker_seats
FOR EACH ROW EXECUTE FUNCTION public.op_protect_in_hand_seat_stacks();

DROP TRIGGER IF EXISTS trg_op_carry_terminal_hand_stacks ON public.online_poker_hands;
CREATE TRIGGER trg_op_carry_terminal_hand_stacks AFTER INSERT OR UPDATE OF status ON public.online_poker_hands
FOR EACH ROW EXECUTE FUNCTION public.op_carry_terminal_hand_stacks();
