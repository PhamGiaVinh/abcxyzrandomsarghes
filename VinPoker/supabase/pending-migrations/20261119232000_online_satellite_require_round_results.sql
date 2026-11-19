-- G04: keep the single-table result command from locking a partial roster.
BEGIN;
ALTER FUNCTION public.lock_online_satellite_result_v1(uuid,uuid,integer)
  SET SCHEMA online_satellite_private;
REVOKE ALL ON FUNCTION online_satellite_private.lock_online_satellite_result_v1(uuid,uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lock_online_satellite_result_v1(
  p_pilot_id uuid, p_expected_hand_id uuid, p_expected_hand_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  anchor_table uuid;
BEGIN
  PERFORM 1 FROM online_satellite_private.pilots WHERE id=p_pilot_id FOR UPDATE;
  SELECT table_id INTO anchor_table FROM online_satellite_private.table_clocks WHERE pilot_id=p_pilot_id;
  IF actor IS NULL OR NOT FOUND OR NOT public.op_lock_satellite_manual_dealer(anchor_table,actor) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM online_satellite_private.round_tables WHERE pilot_id=p_pilot_id) THEN
    RETURN jsonb_build_object('outcome','round_result_required');
  END IF;
  RETURN online_satellite_private.lock_online_satellite_result_v1(
    p_pilot_id,p_expected_hand_id,p_expected_hand_version);
END;
$$;
REVOKE ALL ON FUNCTION public.lock_online_satellite_result_v1(uuid,uuid,integer)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.lock_online_satellite_result_v1(uuid,uuid,integer) TO authenticated;
COMMIT;
