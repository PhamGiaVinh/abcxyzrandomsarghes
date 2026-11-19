-- G04: the TD requests the next round against the last observed round.
BEGIN;
CREATE FUNCTION public.open_online_satellite_round_v1(p_pilot_id uuid, p_expected_round bigint)
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
    WHERE m.pilot_id=p_pilot_id AND 2 > (
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
REVOKE ALL ON FUNCTION public.open_online_satellite_round_v1(uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.open_online_satellite_round_v1(uuid,bigint) TO authenticated;
COMMIT;
