-- CLI candidate20261023192359 -> reserved forward264. LOCAL ONLY, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000264')
 OR to_regprocedure('public.get_club_finance_summary_v2(date,date,uuid)') IS NOT NULL
 OR md5(pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure)) IS DISTINCT FROM '157eb1862f4e1e5115ad7b0832269931'
 THEN RAISE EXCEPTION 'finance264_catalog_drift';END IF;
END $$;

-- Read-only adapter. Existing authoritative money/payroll formulas and club
-- authority stay in v1; do not change its legacy inclusive timestamp contract.
CREATE FUNCTION public.get_club_finance_summary_v2(p_from_date date,p_to_date date,p_club_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path='' SET timezone='Asia/Ho_Chi_Minh' AS $$
DECLARE start_at timestamptz;end_at timestamptz;result jsonb;
BEGIN
 IF p_from_date IS NULL OR p_to_date IS NULL OR NOT isfinite(p_from_date) OR NOT isfinite(p_to_date)
 OR p_from_date>p_to_date OR p_from_date<date '0001-01-01'
 THEN RAISE EXCEPTION 'finance_report_invalid_dates' USING ERRCODE='22023';END IF;
 start_at := p_from_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
 end_at := (p_to_date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
 -- PostgreSQL timestamp precision is one microsecond. This adapts [start,end)
 -- without losing the last fractional second or including next-day midnight.
 result := public.get_club_finance_summary(start_at,end_at-interval '1 microsecond',p_club_id);
 IF jsonb_typeof(result) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'finance_report_invalid_source';
 END IF;
 RETURN result || jsonb_build_object('fromDate',p_from_date,'toDate',p_to_date,'clubId',p_club_id,
  'periodFrom',start_at,'periodTo',end_at,'periodEndExclusive',true,'timeZone','Asia/Ho_Chi_Minh');
END $$;
REVOKE ALL ON FUNCTION public.get_club_finance_summary_v2(date,date,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_club_finance_summary_v2(date,date,uuid) TO authenticated;
COMMIT;
