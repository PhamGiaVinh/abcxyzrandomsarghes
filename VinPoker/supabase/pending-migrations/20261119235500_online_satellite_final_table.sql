-- G04: retire a drained table at a completed round boundary.
BEGIN;
ALTER TABLE online_satellite_private.round_tables
  ADD COLUMN retired_after_round bigint CHECK (retired_after_round >= 0);

CREATE OR REPLACE FUNCTION online_satellite_private.open_next_round(p_pilot_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  latest_round bigint;
BEGIN
  -- All round controllers serialize here. No seat or hand lock is taken
  -- here, so an in-flight deal or settlement can finish independently.
  PERFORM 1 FROM online_satellite_private.pilots WHERE id = p_pilot_id FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM online_satellite_private.round_tables
    WHERE pilot_id = p_pilot_id) < 2 THEN
    RAISE EXCEPTION 'online_satellite_round_requires_multiple_tables' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_tables m
    JOIN online_satellite_private.pilots p ON p.id = m.pilot_id
    JOIN public.online_poker_tables t ON t.id = m.table_id
    WHERE m.pilot_id = p_pilot_id AND m.retired_after_round IS NULL
      AND (NOT t.is_satellite OR t.club_id IS DISTINCT FROM p.club_id OR t.status <> 'open')
  ) THEN
    RAISE EXCEPTION 'online_satellite_round_invalid_table' USING ERRCODE = '23514';
  END IF;

  SELECT max(round_no) INTO latest_round FROM online_satellite_private.round_deals
    WHERE pilot_id = p_pilot_id;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_deals d
    LEFT JOIN public.online_poker_hands h ON h.id = d.hand_id
    WHERE d.pilot_id = p_pilot_id AND d.round_no = latest_round
      AND h.status IS DISTINCT FROM 'complete'
  ) THEN
    RAISE EXCEPTION 'online_satellite_round_still_playing' USING ERRCODE = '23514';
  END IF;

  latest_round := coalesce(latest_round, 0) + 1;
  INSERT INTO online_satellite_private.round_deals(pilot_id, round_no, table_id)
    SELECT pilot_id, latest_round, table_id FROM online_satellite_private.round_tables
      WHERE pilot_id = p_pilot_id AND retired_after_round IS NULL;
  RETURN latest_round;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_online_satellite_round_v1(p_pilot_id uuid, p_expected_round bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  clock_row online_satellite_private.table_clocks%ROWTYPE;
  current_round bigint;
  living_count bigint;
  unique_count bigint;
BEGIN
  IF actor IS NULL OR p_expected_round IS NULL OR p_expected_round < 0 THEN
    RAISE EXCEPTION 'SATELLITE_BAD_ROUND_REQUEST' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT * INTO clock_row FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF NOT FOUND OR NOT public.op_lock_satellite_manual_dealer(clock_row.table_id,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT clock_row FROM online_satellite_private.table_clocks
    WHERE pilot_id=p_pilot_id FOR SHARE;
  SELECT coalesce(max(round_no),0) INTO current_round
    FROM online_satellite_private.round_deals WHERE pilot_id=p_pilot_id;
  IF p_expected_round <> current_round THEN
    RETURN jsonb_build_object('outcome','stale','roundNo',current_round::text);
  END IF;
  IF clock_row.running_since IS NULL OR NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome','paused','roundNo',current_round::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_tables m
    JOIN public.online_poker_hands h ON h.table_id=m.table_id
    WHERE m.pilot_id=p_pilot_id AND h.status IN ('dealing','betting')
  ) OR EXISTS (
    SELECT 1 FROM online_satellite_private.round_deals d
    LEFT JOIN public.online_poker_hands h ON h.id=d.hand_id
    WHERE d.pilot_id=p_pilot_id AND d.round_no=current_round AND h.status IS DISTINCT FROM 'complete'
  ) THEN
    RETURN jsonb_build_object('outcome','round_still_playing','roundNo',current_round::text);
  END IF;

  SELECT count(*),count(DISTINCT s.user_id) INTO living_count,unique_count
  FROM online_satellite_private.round_tables m
  JOIN public.online_poker_seats s ON s.table_id=m.table_id
  WHERE m.pilot_id=p_pilot_id AND s.user_id IS NOT NULL AND s.stack>0;
  IF living_count <> unique_count OR clock_row.qualification_slots IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_ROUND_ROSTER_INVALID' USING ERRCODE='23514';
  END IF;
  IF living_count <= clock_row.qualification_slots THEN
    RETURN jsonb_build_object('outcome','qualification_reached','roundNo',current_round::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_tables m
    WHERE m.pilot_id=p_pilot_id AND m.retired_after_round IS NULL AND 2 > (
      SELECT count(*) FROM public.online_poker_seats s
      WHERE s.table_id=m.table_id AND s.user_id IS NOT NULL AND s.status='sitting' AND s.stack>0
    )
  ) THEN
    RETURN jsonb_build_object('outcome','rebalance_required','roundNo',current_round::text);
  END IF;
  current_round := online_satellite_private.open_next_round(p_pilot_id);
  RETURN jsonb_build_object('outcome','ok','roundNo',current_round::text);
END;
$$;

CREATE FUNCTION public.retire_online_satellite_round_table_v1(
  p_pilot_id uuid,p_table_id uuid,p_expected_round bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  anchor uuid;
  latest bigint;
  retired bigint;
BEGIN
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT table_id INTO anchor FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF NOT FOUND OR actor IS NULL OR NOT public.op_lock_satellite_manual_dealer(anchor,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT retired_after_round INTO retired FROM online_satellite_private.round_tables
    WHERE pilot_id=p_pilot_id AND table_id=p_table_id;
  IF NOT FOUND OR p_table_id=anchor THEN
    RETURN jsonb_build_object('outcome','invalid_table');
  END IF;
  IF retired IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','ok','idempotent',true,'roundNo',retired::text);
  END IF;
  SELECT coalesce(max(round_no),0) INTO latest FROM online_satellite_private.round_deals
    WHERE pilot_id=p_pilot_id;
  IF p_expected_round IS DISTINCT FROM latest THEN
    RETURN jsonb_build_object('outcome','stale','roundNo',latest::text);
  END IF;
  IF EXISTS (
    SELECT 1 FROM online_satellite_private.round_deals d
    LEFT JOIN public.online_poker_hands h ON h.id=d.hand_id
    WHERE d.pilot_id=p_pilot_id AND d.round_no=latest AND h.status IS DISTINCT FROM 'complete'
  ) OR EXISTS (
    SELECT 1 FROM online_satellite_private.round_tables m
    JOIN public.online_poker_hands h ON h.table_id=m.table_id
    WHERE m.pilot_id=p_pilot_id AND h.status IN ('dealing','betting')
  ) THEN
    RETURN jsonb_build_object('outcome','round_still_playing');
  END IF;
  IF EXISTS (SELECT 1 FROM online_satellite_private.locked_results WHERE pilot_id=p_pilot_id)
    OR NOT EXISTS (SELECT 1 FROM public.online_poker_tables WHERE id=anchor AND status IN ('open','paused')) THEN
    RETURN jsonb_build_object('outcome','invalid_table');
  END IF;
  PERFORM 1 FROM public.online_poker_seats WHERE table_id=p_table_id ORDER BY seat_no FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.online_poker_seats WHERE table_id=p_table_id AND stack>0) THEN
    RETURN jsonb_build_object('outcome','table_has_players');
  END IF;
  UPDATE public.online_poker_tables SET status='closed' WHERE id=p_table_id;
  UPDATE online_satellite_private.round_tables SET retired_after_round=latest
    WHERE pilot_id=p_pilot_id AND table_id=p_table_id;
  RETURN jsonb_build_object('outcome','ok','idempotent',false,'roundNo',latest::text);
END;
$$;
REVOKE ALL ON FUNCTION public.retire_online_satellite_round_table_v1(uuid,uuid,bigint)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.retire_online_satellite_round_table_v1(uuid,uuid,bigint) TO authenticated;
COMMIT;
