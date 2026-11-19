-- Pending single-table pilot qualification record. No ticket or ledger writes.
BEGIN;

CREATE TABLE IF NOT EXISTS online_satellite_private.locked_results (
  pilot_id uuid PRIMARY KEY REFERENCES online_satellite_private.pilots(id),
  table_id uuid NOT NULL UNIQUE REFERENCES public.online_poker_tables(id),
  hand_id uuid REFERENCES public.online_poker_hands(id),
  hand_version integer,
  qualification_slots integer NOT NULL CHECK (qualification_slots BETWEEN 1 AND 9),
  qualified_entries uuid[] NOT NULL,
  locked_by uuid NOT NULL REFERENCES auth.users(id),
  locked_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((hand_id IS NULL) = (hand_version IS NULL)),
  CHECK (cardinality(qualified_entries) = qualification_slots)
);
ALTER TABLE online_satellite_private.locked_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON online_satellite_private.locked_results FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.lock_online_satellite_result_v1(
  p_pilot_id uuid, p_expected_hand_id uuid, p_expected_hand_version integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  bound_table uuid;
  current_clock online_satellite_private.table_clocks%ROWTYPE;
  last_hand public.online_poker_hands%ROWTYPE;
  locked online_satellite_private.locked_results%ROWTYPE;
  seat_count integer;
  entries uuid[];
  confirmed_entries uuid[];
BEGIN
  SELECT c.table_id INTO bound_table FROM online_satellite_private.table_clocks c
    WHERE c.pilot_id=p_pilot_id;
  IF actor IS NULL OR NOT FOUND OR NOT public.op_lock_satellite_manual_dealer(bound_table,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  -- Same lock order as the deal writer; settlement owns the seats until commit.
  PERFORM 1 FROM public.online_poker_seats WHERE table_id=bound_table ORDER BY seat_no FOR UPDATE;
  PERFORM 1 FROM public.online_poker_tables t
    JOIN online_satellite_private.pilots p ON p.id=p_pilot_id AND p.club_id=t.club_id
    WHERE t.id=bound_table FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT current_clock FROM online_satellite_private.table_clocks
    WHERE table_id=bound_table FOR UPDATE;
  SELECT * INTO locked FROM online_satellite_private.locked_results WHERE pilot_id=p_pilot_id;
  IF FOUND THEN
    IF locked.hand_id IS DISTINCT FROM p_expected_hand_id
      OR locked.hand_version IS DISTINCT FROM p_expected_hand_version THEN
      RETURN jsonb_build_object('outcome','stale');
    END IF;
    RETURN jsonb_build_object('outcome','ok','idempotent',true,'qualifiedCount',locked.qualification_slots);
  END IF;
  SELECT * INTO last_hand FROM public.online_poker_hands h
    WHERE h.table_id=bound_table ORDER BY h.hand_no DESC LIMIT 1;
  IF last_hand.id IS DISTINCT FROM p_expected_hand_id
    OR last_hand.state_version IS DISTINCT FROM p_expected_hand_version THEN
    RETURN jsonb_build_object('outcome','stale');
  END IF;
  IF (last_hand.id IS NOT NULL AND last_hand.status <> 'complete') OR current_clock.qualification_slots IS NULL THEN
    RETURN jsonb_build_object('outcome','not_ready');
  END IF;
  SELECT count(*), array_agg(e.id ORDER BY s.seat_no)
    INTO seat_count,entries
  FROM public.online_poker_seats s
  LEFT JOIN online_satellite_private.entries e ON e.pilot_id=p_pilot_id AND e.player_user_id=s.user_id
  WHERE s.table_id=bound_table AND s.stack>0;
  IF seat_count>current_clock.qualification_slots THEN
    RETURN jsonb_build_object('outcome','not_ready');
  END IF;
  IF seat_count<current_clock.qualification_slots THEN
    RETURN jsonb_build_object('outcome','bubble_review_required');
  END IF;
  IF array_position(entries,NULL::uuid) IS NOT NULL
    OR (SELECT count(DISTINCT e) FROM unnest(entries) e) <> seat_count THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_ROSTER' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(e.id ORDER BY e.id) INTO confirmed_entries
  FROM online_satellite_private.entries e
  JOIN online_satellite_private.pilots p ON p.id=e.pilot_id
  LEFT JOIN LATERAL (
    SELECT hs.stack
    FROM public.online_poker_hands h JOIN public.online_poker_hand_seats hs ON hs.hand_id=h.id
    WHERE h.table_id=bound_table AND h.status='complete' AND h.hand_no<=last_hand.hand_no
      AND hs.user_id=e.player_user_id
    ORDER BY h.hand_no DESC LIMIT 1
  ) history ON true
  WHERE e.pilot_id=p_pilot_id AND COALESCE(history.stack,p.starting_stack)>0;
  IF confirmed_entries IS DISTINCT FROM ARRAY(SELECT e FROM unnest(entries) e ORDER BY e) THEN
    RETURN jsonb_build_object('outcome','roster_unverified');
  END IF;
  INSERT INTO online_satellite_private.locked_results(
    pilot_id,table_id,hand_id,hand_version,qualification_slots,qualified_entries,locked_by
  ) VALUES (p_pilot_id,bound_table,last_hand.id,last_hand.state_version,current_clock.qualification_slots,entries,actor);
  UPDATE online_satellite_private.table_clocks SET
    elapsed_seconds=elapsed_seconds+COALESCE(GREATEST(0,extract(epoch FROM clock_timestamp()-running_since)),0),
    running_since=NULL,revision=revision+1 WHERE table_id=bound_table;
  UPDATE public.online_poker_tables SET status='closed' WHERE id=bound_table;
  RETURN jsonb_build_object('outcome','ok','idempotent',false,'qualifiedCount',seat_count);
END;
$$;

REVOKE ALL ON FUNCTION public.lock_online_satellite_result_v1(uuid,uuid,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.lock_online_satellite_result_v1(uuid,uuid,integer) TO authenticated;

COMMIT;
