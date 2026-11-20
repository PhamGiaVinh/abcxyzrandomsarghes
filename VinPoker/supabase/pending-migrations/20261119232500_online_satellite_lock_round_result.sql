-- G04: immutable qualification evidence for an exact completed multi-table round.
BEGIN;
ALTER TABLE online_satellite_private.locked_results
  ADD COLUMN round_no bigint CHECK (round_no > 0),
  ADD COLUMN round_hands jsonb,
  ADD CHECK ((round_no IS NULL) = (round_hands IS NULL));

CREATE FUNCTION public.lock_online_satellite_round_result_v1(p_pilot_id uuid, p_expected_round bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  clock_row online_satellite_private.table_clocks%ROWTYPE;
  locked online_satellite_private.locked_results%ROWTYPE;
  current_round bigint;
  current_entries uuid[];
  confirmed_entries uuid[];
  evidence jsonb;
BEGIN
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT * INTO clock_row FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF actor IS NULL OR NOT FOUND OR NOT public.op_lock_satellite_manual_dealer(clock_row.table_id,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO locked FROM online_satellite_private.locked_results WHERE pilot_id=p_pilot_id;
  IF FOUND THEN
    IF locked.round_no IS NULL OR locked.round_no IS DISTINCT FROM p_expected_round THEN
      RETURN jsonb_build_object('outcome','stale');
    END IF;
    RETURN jsonb_build_object('outcome','ok','idempotent',true,'qualifiedCount',locked.qualification_slots);
  END IF;
  SELECT max(round_no) INTO current_round FROM online_satellite_private.round_deals WHERE pilot_id=p_pilot_id;
  IF current_round IS NULL OR current_round IS DISTINCT FROM p_expected_round THEN
    RETURN jsonb_build_object('outcome','stale');
  END IF;
  IF clock_row.qualification_slots IS NULL OR EXISTS (
    SELECT 1 FROM online_satellite_private.round_deals d
    LEFT JOIN public.online_poker_hands h ON h.id=d.hand_id AND h.table_id=d.table_id
    WHERE d.pilot_id=p_pilot_id AND d.round_no=current_round AND h.status IS DISTINCT FROM 'complete'
  ) THEN
    RETURN jsonb_build_object('outcome','not_ready');
  END IF;

  SELECT ARRAY(
    SELECT e.id FROM online_satellite_private.round_tables m
    JOIN public.online_poker_seats s ON s.table_id=m.table_id
    LEFT JOIN online_satellite_private.entries e ON e.pilot_id=m.pilot_id AND e.player_user_id=s.user_id
    WHERE m.pilot_id=p_pilot_id AND s.stack>0 ORDER BY e.id
  ) INTO current_entries;
  IF array_position(current_entries,NULL::uuid) IS NOT NULL
    OR (SELECT count(DISTINCT e) FROM unnest(current_entries) e) <> cardinality(current_entries) THEN
    RETURN jsonb_build_object('outcome','roster_unverified');
  END IF;
  IF cardinality(current_entries)>clock_row.qualification_slots THEN
    RETURN jsonb_build_object('outcome','not_ready');
  END IF;
  IF cardinality(current_entries)<clock_row.qualification_slots THEN
    RETURN jsonb_build_object('outcome','bubble_review_required');
  END IF;

  SELECT ARRAY(
    SELECT e.id FROM online_satellite_private.entries e
    JOIN online_satellite_private.pilots p ON p.id=e.pilot_id
    LEFT JOIN LATERAL (
      SELECT hs.stack
      FROM online_satellite_private.round_deals d
      JOIN public.online_poker_hands h ON h.id=d.hand_id AND h.table_id=d.table_id AND h.status='complete'
      JOIN public.online_poker_hand_seats hs ON hs.hand_id=h.id AND hs.user_id=e.player_user_id
      WHERE d.pilot_id=e.pilot_id AND d.round_no<=current_round
      ORDER BY d.round_no DESC LIMIT 1
    ) last_stack ON true
    WHERE e.pilot_id=p_pilot_id AND coalesce(last_stack.stack,p.starting_stack)>0 ORDER BY e.id
  ) INTO confirmed_entries;
  IF current_entries IS DISTINCT FROM confirmed_entries THEN
    RETURN jsonb_build_object('outcome','roster_unverified');
  END IF;
  SELECT jsonb_agg(jsonb_build_object('tableId',d.table_id,'handId',h.id,'handVersion',h.state_version)
    ORDER BY d.table_id) INTO evidence
  FROM online_satellite_private.round_deals d JOIN public.online_poker_hands h ON h.id=d.hand_id
  WHERE d.pilot_id=p_pilot_id AND d.round_no=current_round;
  INSERT INTO online_satellite_private.locked_results(
    pilot_id,table_id,qualification_slots,qualified_entries,locked_by,round_no,round_hands)
    VALUES (p_pilot_id,clock_row.table_id,clock_row.qualification_slots,current_entries,actor,current_round,evidence);
  UPDATE public.online_poker_tables t SET status='closed'
    FROM online_satellite_private.round_tables m WHERE m.pilot_id=p_pilot_id AND m.table_id=t.id;
  UPDATE online_satellite_private.table_clocks SET
    elapsed_seconds=elapsed_seconds+coalesce(greatest(0,extract(epoch FROM clock_timestamp()-running_since)),0),
    running_since=NULL,revision=revision+1 WHERE pilot_id=p_pilot_id;
  RETURN jsonb_build_object('outcome','ok','idempotent',false,'qualifiedCount',cardinality(current_entries));
END;
$$;
REVOKE ALL ON FUNCTION public.lock_online_satellite_round_result_v1(uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.lock_online_satellite_round_result_v1(uuid,bigint) TO authenticated;
COMMIT;
