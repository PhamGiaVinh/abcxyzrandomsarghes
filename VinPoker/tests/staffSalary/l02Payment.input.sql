BEGIN;
DO $test$
DECLARE
  actor constant uuid := '16680000-0000-4000-8000-000000000002';
  club constant uuid := '16680000-0000-4000-8000-000000000011';
  staff constant uuid := '16680000-0000-4000-8000-000000000023';
  obligation constant uuid := '16680000-0000-4000-8000-000000000033';
  result jsonb;
BEGIN
  ASSERT current_database()='vinpoker_ops_l02';
  INSERT INTO public.staff(id,club_id,full_name,department,employment_type,monthly_salary_vnd)
    VALUES(staff,club,'L02 input TEST FT','service','full_time',5000000);
  INSERT INTO public.staff_salary_runs(id,club_id,staff_id,period_year,period_month,employment_type,
    worked_days,gross_vnd,manual_bhxh_vnd,manual_tax_vnd,net_vnd,status,locked_by)
    VALUES(obligation,club,staff,2026,11,'full_time',26,5000000,0,0,5000000,'locked',actor);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  SET LOCAL ROLE authenticated;
  result:=public.mark_staff_salary_paid(obligation,'bank_transfer','   ');
  ASSERT result->>'error'='PAYMENT_REFERENCE_REQUIRED', result::text;
  result:=public.mark_staff_salary_paid(obligation,NULL,NULL);
  ASSERT result->>'error'='INVALID_PAYMENT_METHOD', result::text;
  result:=public.mark_staff_salary_paid(obligation,'card',NULL);
  ASSERT result->>'error'='INVALID_PAYMENT_METHOD', result::text;
  result:=public.mark_staff_salary_paid(obligation,'cash','UNEXPECTED-REFERENCE');
  ASSERT result->>'error'='INVALID_PAYMENT_REFERENCE', result::text;
  RESET ROLE;
  ASSERT (SELECT status FROM public.staff_salary_runs WHERE id=obligation)='locked';
  SET LOCAL ROLE authenticated;
  result:=public.mark_staff_salary_paid(obligation,'bank_transfer',' TEST-INPUT ');
  ASSERT result->>'status'='paid' AND result->>'idempotent'='false', result::text;
  ASSERT result->>'payment_reference'='TEST-INPUT';
  ASSERT (result->>'net_vnd')::bigint=5000000;
  ASSERT result->>'club_id'=club::text AND result->>'staff_id'=staff::text;
  RESET ROLE;
  ASSERT EXISTS(SELECT 1 FROM public.staff_salary_runs WHERE id=obligation
    AND status='paid' AND net_vnd=5000000 AND payment_reference='TEST-INPUT');
END
$test$;
ROLLBACK;
