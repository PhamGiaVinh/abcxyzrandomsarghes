-- Read-only candidate. Rollback after consumers are reverted:
-- DROP FUNCTION IF EXISTS public.get_my_staff_ft_payslips_v1(uuid, uuid);
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
    'payslips', COALESCE((
      SELECT jsonb_agg(to_jsonb(slip) ORDER BY slip.period_year DESC, slip.period_month DESC, slip.id)
      FROM (
        SELECT run.id, run.period_year, run.period_month, run.net_vnd,
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
