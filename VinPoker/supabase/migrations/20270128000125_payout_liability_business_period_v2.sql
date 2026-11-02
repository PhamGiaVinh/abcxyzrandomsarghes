-- SOURCE/LOCAL ONLY. CLI generated20261016215924; forward catalog slot125.
-- Preserve existing liability math/authorization; define inclusive Vietnam dates
-- as a half-open timestamp interval. Legacy <= p_to receives its exact last microsecond.
-- Recovery: revoke this v2 read entrypoint; no data changes need compensation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'payout125_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure),chr(13),''))
   <>'b5310e79a0e82f5cf530ad334404136f' THEN RAISE EXCEPTION 'payout125_reader_drift'; END IF;
 IF to_regprocedure('public.get_club_payout_liability_v2(date,date,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'payout125_catalog_collision'; END IF;
END;$$;
CREATE FUNCTION public.get_club_payout_liability_v2(p_from_date date,p_to_date date,p_club_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE start_at timestamptz;until_at timestamptz;result jsonb;
BEGIN
 IF p_from_date IS NULL OR p_to_date IS NULL OR p_to_date<p_from_date
   OR NOT isfinite(p_from_date) OR NOT isfinite(p_to_date)
 THEN RAISE EXCEPTION 'invalid_report_dates' USING ERRCODE='22007'; END IF;
 start_at:=p_from_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
 until_at:=(p_to_date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
 result:=public.get_club_payout_liability(start_at,until_at-interval '1 microsecond',p_club_id);
 RETURN result||jsonb_build_object('periodFrom',start_at,'periodTo',until_at,'periodEndExclusive',true,
   'fromDate',p_from_date,'toDate',p_to_date,'timeZone','Asia/Ho_Chi_Minh','clubId',p_club_id);
END;$$;
REVOKE ALL ON FUNCTION public.get_club_payout_liability_v2(date,date,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_club_payout_liability_v2(date,date,uuid) TO authenticated;
COMMIT;
