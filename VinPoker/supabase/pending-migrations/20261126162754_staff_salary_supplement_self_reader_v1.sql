-- Additive self receipt metadata only. Preserve self/deleted-staff authorization and saved amounts.
-- ROLLBACK: retain this compatible reader while supplementary receipts exist; do not revert to an incompatible frontend.
DO $guard$ BEGIN
 IF to_regprocedure('public.get_my_staff_ft_payslips_v1(uuid,uuid)') IS NULL OR (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('public.get_my_staff_ft_payslips_v1(uuid,uuid)')) NOT IN ('674a92152fa045f26f456290d25742eb','66b82fcf206cf355936e2504370a05ce') THEN RAISE EXCEPTION 'STAFF_SALARY_SELF_READER_SOURCE_DRIFT';END IF;
 IF to_regclass('floor_private.staff_salary_adjustment_requests_v1') IS NULL THEN RAISE EXCEPTION 'STAFF_SALARY_SELF_READER_REQUIRES_SUPPLEMENTS';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_my_staff_ft_payslips_v1(p_staff_id uuid, p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff AS staff
    WHERE staff.id = p_staff_id AND staff.club_id = p_club_id
      AND staff.user_id = v_user_id AND staff.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'staff_id', p_staff_id,
    'club_id', p_club_id,
    'pending_adjustments', COALESCE((
      SELECT jsonb_agg(to_jsonb(pending) ORDER BY pending.period_year DESC,pending.period_month DESC,pending.id)
      FROM (
        SELECT q.id,q.base_run_id,q.period_year,q.period_month,q.amount_vnd
        FROM floor_private.staff_salary_adjustment_requests_v1 q
        JOIN public.staff_salary_runs base ON base.id=q.base_run_id AND base.staff_id=q.staff_id AND base.club_id=q.club_id
        LEFT JOIN public.staff_salary_periods period ON period.club_id=base.club_id AND period.period_year=base.period_year AND period.period_month=base.period_month
        WHERE q.staff_id=p_staff_id AND q.club_id=p_club_id AND q.state='pending'
          AND (base.status='paid' OR (base.status='locked' AND period.status='approved'))
        ORDER BY q.period_year DESC,q.period_month DESC,q.id LIMIT 20
      ) pending
    ),'[]'::jsonb),
    'payslips', COALESCE((
      SELECT jsonb_agg(to_jsonb(slip) ORDER BY slip.period_year DESC, slip.period_month DESC, slip.id)
      FROM (
        SELECT run.id, run.adjusts_id, run.period_year, run.period_month, run.net_vnd,
          CASE WHEN run.adjusts_id IS NULL THEN
            CASE WHEN EXISTS(SELECT 1 FROM floor_private.staff_salary_sources_v1 WHERE run_id=run.id) THEN 'verified' ELSE 'unverified' END
          ELSE CASE WHEN EXISTS(SELECT 1 FROM floor_private.staff_salary_adjustment_requests_v1 q WHERE q.child_run_id=run.id AND q.base_run_id=run.adjusts_id AND q.state='approved') THEN 'verified' ELSE 'unverified' END END AS source_status,
          CASE WHEN run.status = 'paid' THEN 'recorded_paid' ELSE 'approved' END AS status,
          CASE WHEN run.status = 'paid' THEN run.paid_at END AS paid_at,
          CASE WHEN run.status = 'paid' THEN run.payment_method END AS payment_method
        FROM public.staff_salary_runs AS run
        LEFT JOIN public.staff_salary_periods AS period
          ON period.club_id = run.club_id AND period.period_year = run.period_year
          AND period.period_month = run.period_month
        WHERE run.staff_id = p_staff_id AND run.club_id = p_club_id
          AND run.employment_type = 'full_time'
          AND (run.status = 'paid' OR (run.status = 'locked' AND period.status = 'approved'))
        ORDER BY run.period_year DESC, run.period_month DESC, run.id
        LIMIT 20
      ) AS slip
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_staff_ft_payslips_v1(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_staff_ft_payslips_v1(uuid, uuid) TO authenticated;
