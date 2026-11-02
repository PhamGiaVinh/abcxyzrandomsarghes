-- Forward read contract; never replay the historical dealer_scores view chain.
-- Formula matches 20260613000003: 30-day metrics, hours + swings/2 + tier bonus.
-- No payroll/override writes or direct metrics grant. Rollback: revert consumer,
-- revoke authenticated EXECUTE on this exact signature; keep all history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000190')
 OR to_regprocedure('public.get_dealer_scores_v1(uuid)') IS NOT NULL
 OR to_regclass('public.dealer_shift_metrics') IS NULL
 OR to_regprocedure('public.is_club_dealer_control(uuid,uuid)') IS NULL
 OR to_regprocedure('public.is_club_admin(uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'dealer_scores190_baseline_drift_or_collision';END IF;
END $$;
CREATE FUNCTION public.get_dealer_scores_v1(p_club_id uuid)
RETURNS TABLE(dealer_id uuid,full_name text,tier text,club_id uuid,employment_type text,
 total_hours numeric,total_swings bigint,score numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_club_id IS NULL OR NOT (
  public.is_club_dealer_control(auth.uid(),p_club_id)
  OR public.is_club_admin(auth.uid(),p_club_id)
  OR public.has_role(auth.uid(),'super_admin'::public.app_role)
 ) THEN RAISE EXCEPTION 'dealer_scores_forbidden' USING ERRCODE='42501';END IF;
 RETURN QUERY
 SELECT d.id,d.full_name::text,d.tier::text,d.club_id,d.employment_type::text,
  coalesce(round(sum(m.total_worked_minutes)/60.0,1),0),
  coalesce(sum(m.total_assignments),0)::bigint,
  coalesce(round(sum(m.total_worked_minutes)/60.0,1),0)*1.0
   +coalesce(sum(m.total_assignments),0)*0.5
   +CASE d.tier WHEN 'A' THEN 20 WHEN 'B' THEN 10 ELSE 0 END
 FROM public.dealers d
 LEFT JOIN public.dealer_attendance a ON a.dealer_id=d.id AND a.shift_date>=CURRENT_DATE-30
 LEFT JOIN public.dealer_shift_metrics m ON m.attendance_id=a.id
 WHERE d.club_id=p_club_id
 GROUP BY d.id,d.full_name,d.tier,d.club_id,d.employment_type
 ORDER BY 8 DESC,d.id;
END $$;
REVOKE ALL ON FUNCTION public.get_dealer_scores_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_dealer_scores_v1(uuid) TO authenticated;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.get_dealer_scores_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_dealer_scores_v1(uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.get_dealer_scores_v1(uuid)','EXECUTE');
END $$;
COMMIT;
