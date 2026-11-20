-- G04: reject stale move commands even if the round number has not changed.
BEGIN;
CREATE INDEX round_seat_moves_pilot_seat_idx
  ON online_satellite_private.round_seat_moves(pilot_id,seat_id);

CREATE FUNCTION public.move_online_satellite_round_seat_v2(
  p_pilot_id uuid, p_seat_id uuid, p_destination uuid, p_destination_seat int,
  p_expected_round bigint, p_expected_placement bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  anchor_table uuid;
  placement bigint;
  result jsonb;
BEGIN
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT table_id INTO anchor_table FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF NOT FOUND OR actor IS NULL OR NOT public.op_lock_satellite_manual_dealer(anchor_table,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO placement FROM online_satellite_private.round_seat_moves
    WHERE pilot_id=p_pilot_id AND seat_id=p_seat_id;
  IF p_expected_placement IS DISTINCT FROM placement THEN
    RETURN jsonb_build_object('outcome','stale_placement','placementRevision',placement::text);
  END IF;
  result := public.move_online_satellite_round_seat_v1(
    p_pilot_id,p_seat_id,p_destination,p_destination_seat,p_expected_round);
  IF result->>'outcome'='ok' THEN
    RETURN result || jsonb_build_object('placementRevision',(placement+1)::text);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.move_online_satellite_round_seat_v1(uuid,uuid,uuid,int,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.move_online_satellite_round_seat_v2(uuid,uuid,uuid,int,bigint,bigint)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.move_online_satellite_round_seat_v2(uuid,uuid,uuid,int,bigint,bigint)
  TO authenticated;
COMMIT;
