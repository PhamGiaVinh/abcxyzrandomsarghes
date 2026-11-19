\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  owner_a constant uuid := '16660000-0000-4000-8000-000000000001';
  actor_b constant uuid := '16660000-0000-4000-8000-000000000002';
  owner_b constant uuid := '16660000-0000-4000-8000-000000000003';
  club_a constant uuid := '16660000-0000-4000-8000-000000000011';
  club_b constant uuid := '16660000-0000-4000-8000-000000000012';
  result jsonb;
BEGIN
  ASSERT current_database() = 'vinpoker_ops_l01', 'Require disposable L01 database';
  INSERT INTO auth.users (id) VALUES (owner_a), (actor_b), (owner_b);
  INSERT INTO public.profiles (user_id, display_name)
    VALUES (owner_a, 'L01 owner A'), (actor_b, 'L01 actor B'), (owner_b, 'L01 owner B');
  INSERT INTO public.clubs (id, owner_id, name, region, status)
    VALUES (club_a, owner_a, 'L01 fixture A', 'TEST', 'approved'),
           (club_b, owner_b, 'L01 fixture B', 'TEST', 'approved');
  INSERT INTO public.club_accountants (club_id, user_id, granted_by)
    VALUES (club_b, actor_b, owner_b);

  PERFORM set_config('request.jwt.claim.sub', actor_b::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor_b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  result := public.chot_staff_salary_month(club_b, 2026, 11);
  ASSERT result->>'status' = 'ok' AND result->>'club_id' = club_b::text;

  BEGIN
    PERFORM public.chot_staff_salary_month(club_a, 2026, 11);
    RAISE EXCEPTION 'Salary writer accepted a different club';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  result := public.save_payroll_period_v2(club_b, 2026, 11, '2026-11-01', '2026-11-30', '[]',
    '16660000-0000-4000-8000-000000000021');
  ASSERT result->>'outcome' = 'saved' AND result->>'clubId' = club_b::text;

  BEGIN
    PERFORM public.save_payroll_period_v2(club_a, 2026, 11, '2026-11-01', '2026-11-30', '[]',
      '16660000-0000-4000-8000-000000000022');
    RAISE EXCEPTION 'Dealer payroll accepted a different club';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  result := public.record_club_expense(p_club_id=>club_b, p_category=>'misc', p_amount_vnd=>10000,
    p_incurred_at=>now(), p_description=>'L01 TEST expense', p_payment_status=>'unpaid',
    p_idempotency_key=>'16660000-0000-4000-8000-000000000023');
  ASSERT result->>'status' = 'ok' AND result->>'expense_id' IS NOT NULL;

  BEGIN
    PERFORM public.record_club_expense(p_club_id=>club_a, p_category=>'misc', p_amount_vnd=>10000,
      p_incurred_at=>now(), p_description=>'L01 TEST denied', p_payment_status=>'unpaid',
      p_idempotency_key=>'16660000-0000-4000-8000-000000000024');
    RAISE EXCEPTION 'Expense writer accepted a different club';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  ASSERT NOT EXISTS (SELECT FROM public.payroll_periods WHERE club_id = club_a);
  ASSERT NOT EXISTS (SELECT FROM public.club_expenses WHERE club_id = club_a);
  ASSERT EXISTS (SELECT FROM public.club_expenses WHERE club_id = club_b AND amount_vnd = 10000);
  ASSERT NOT EXISTS (
    SELECT FROM public.staff_salary_periods WHERE club_id = club_a
  ), 'Denied salary request created a period';
  ASSERT NOT EXISTS (
    SELECT FROM public.staff_salary_runs WHERE club_id = club_a
  ), 'Denied salary request created a run';
  DELETE FROM public.club_accountants WHERE club_id = club_b AND user_id = actor_b;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.chot_staff_salary_month(club_b, 2026, 12);
    RAISE EXCEPTION 'Staff salary writer accepted revoked membership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_payroll_period_v2(club_b, 2026, 12, '2026-12-01', '2026-12-31', '[]',
      '16660000-0000-4000-8000-000000000025');
    RAISE EXCEPTION 'Dealer payroll accepted revoked membership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.record_club_expense(p_club_id=>club_b, p_category=>'misc', p_amount_vnd=>10000,
      p_incurred_at=>now(), p_description=>'L01 TEST revoked', p_payment_status=>'unpaid',
      p_idempotency_key=>'16660000-0000-4000-8000-000000000026');
    RAISE EXCEPTION 'Expense writer accepted revoked membership';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  ASSERT (SELECT count(*) FROM public.club_expenses WHERE club_id = club_b) = 1;
END
$test$;
ROLLBACK;
