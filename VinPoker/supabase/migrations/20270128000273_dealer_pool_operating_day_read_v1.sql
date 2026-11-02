-- Worker read fence, reusing222's exact operating-day policy.272 remains the
-- commit fence; this snapshot cannot authorize a later acquisition by itself.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[])') IS NOT NULL
 OR md5(replace(pg_get_functiondef('floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz)'::regprocedure),chr(13),''))<>'380e30a5877e74edfdcb15c879856f59'
 THEN RAISE EXCEPTION 'dealer_pool273_contract_drift'; END IF;
END $$;
CREATE FUNCTION public.get_dealer_pool_eligible_attendance_v1(p_club_id uuid,p_attendance_ids uuid[])
RETURNS TABLE(attendance_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'DEALER_POOL_READ_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_club_id IS NULL OR p_attendance_ids IS NULL OR array_position(p_attendance_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'DEALER_POOL_READ_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT a.id FROM public.dealer_attendance a
 WHERE a.id=ANY(p_attendance_ids) AND a.status='checked_in' AND a.check_out_time IS NULL
  AND floor_private.dealer_pool_attendance_matches_v1(a.dealer_id,p_club_id,pg_catalog.statement_timestamp())
 ORDER BY a.id;
END $$;
REVOKE ALL ON FUNCTION public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dealer_pool_eligible_attendance_v1(uuid,uuid[]) TO service_role;
COMMIT;
-- Recovery: revert dependent Edge callers first, then REVOKE EXECUTE FROM
-- service_role for this exact RPC. Retain history; no operational data repair.
