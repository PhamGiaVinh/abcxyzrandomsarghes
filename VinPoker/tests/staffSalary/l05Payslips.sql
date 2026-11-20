BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_l05' THEN
    RAISE EXCEPTION 'Expected isolated L05 test database';
  END IF;
END $$;
\i supabase/pending-migrations/20261119093017_staff_self_ft_payslips_v1.sql
\if :{?l05_browser}
SET LOCAL l05.browser = 'on';
\endif

DO $fixture$
DECLARE
  a constant uuid := '16840000-0000-4000-8000-000000000001';
  b constant uuid := '16840000-0000-4000-8000-000000000002';
  owner_a constant uuid := '16840000-0000-4000-8000-000000000003';
  club_a constant uuid := '16840000-0000-4000-8000-000000000011';
  club_b constant uuid := '16840000-0000-4000-8000-000000000012';
  ft constant uuid := '16840000-0000-4000-8000-000000000021';
  pt constant uuid := '16840000-0000-4000-8000-000000000022';
  approved_run uuid;
  result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (a), (b), (owner_a);
  INSERT INTO public.profiles(user_id, display_name) VALUES (a, 'L05 FT'), (b, 'L05 PT'), (owner_a, 'L05 Owner');
  INSERT INTO public.clubs(id, owner_id, name, region, status)
    VALUES (club_a, owner_a, 'L05 TEST A', 'TEST', 'approved'), (club_b, b, 'L05 TEST B', 'TEST', 'approved');
  INSERT INTO public.staff(id, user_id, club_id, full_name, department, employment_type, monthly_salary_vnd)
    VALUES (ft, a, club_a, 'L05 FT', 'service', 'full_time', 5200000),
           (pt, b, club_b, 'L05 PT', 'service', 'part_time', 0);
  INSERT INTO public.staff_salary_periods(club_id, period_year, period_month, status, prepared_by, prepared_at, approved_by, approved_at)
    VALUES (club_a, 2026, 10, 'approved', a, now(), a, now());
  INSERT INTO public.staff_salary_runs(club_id, staff_id, period_year, period_month, employment_type,
    gross_vnd, net_vnd, status, locked_by, paid_at, paid_by, payment_method)
    VALUES (club_a, ft, 2026, 9, 'full_time', 5000000, 4800000, 'paid', a, '2026-10-01 01:00Z', a, 'bank_transfer'),
           (club_a, ft, 2026, 10, 'full_time', 5000000, 4900000, 'locked', a, NULL, NULL, NULL),
           (club_a, ft, 2026, 11, 'full_time', 5000000, 4950000, 'locked', a, NULL, NULL, NULL),
           (club_b, pt, 2026, 9, 'part_time', 700000, 700000, 'paid', b, '2026-10-01 01:00Z', b, 'cash');

  SELECT id INTO STRICT approved_run FROM public.staff_salary_runs
    WHERE staff_id = ft AND club_id = club_a AND period_year = 2026 AND period_month = 10;
  ASSERT NOT has_function_privilege('anon', 'public.get_my_staff_ft_payslips_v1(uuid,uuid)', 'EXECUTE');
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  result := public.get_my_staff_ft_payslips_v1(ft, club_a);
  ASSERT (result->>'club_id')::uuid = club_a AND (result->>'staff_id')::uuid = ft;
  ASSERT jsonb_array_length(result->'payslips') = 2;
  ASSERT result#>>'{payslips,0,status}' = 'approved' AND result#>>'{payslips,0,net_vnd}' = '4900000';
  ASSERT result#>>'{payslips,1,status}' = 'recorded_paid' AND result#>>'{payslips,1,net_vnd}' = '4800000';
  ASSERT result#>>'{payslips,1,payment_method}' = 'bank_transfer';
  IF current_setting('l05.browser', true) = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_a::text, true);
  result := public.mark_staff_salary_paid(approved_run, 'bank_transfer', 'TEST-L05-TRANSFER');
  ASSERT result->>'status' = 'paid' AND (result->>'run_id')::uuid = approved_run;
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  result := public.get_my_staff_ft_payslips_v1(ft, club_a);
  ASSERT jsonb_array_length(result->'payslips') = 2;
  ASSERT (result#>>'{payslips,0,id}')::uuid = approved_run;
  ASSERT result#>>'{payslips,0,status}' = 'recorded_paid';
  ASSERT result#>>'{payslips,0,net_vnd}' = '4900000';
  ASSERT result#>>'{payslips,0,payment_method}' = 'bank_transfer';
  ASSERT result#>>'{payslips,0,paid_at}' IS NOT NULL;
  BEGIN
    PERFORM public.get_my_staff_ft_payslips_v1(ft, club_b);
    RAISE EXCEPTION 'Wrong club was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  BEGIN
    PERFORM public.get_my_staff_ft_payslips_v1(ft, club_a);
    RAISE EXCEPTION 'Other actor was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT public.get_my_staff_ft_payslips_v1(pt, club_b)->'payslips' = '[]'::jsonb;
END
$fixture$;
\if :{?l05_browser}
COMMIT;
\else
ROLLBACK;
\endif
