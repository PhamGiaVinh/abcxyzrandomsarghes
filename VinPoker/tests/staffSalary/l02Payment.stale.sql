-- Replaced-run consumer/writer guard; this fixture does not implement a correction producer.
BEGIN;
DO $test$
DECLARE
  club constant uuid := '16680000-0000-4000-8000-000000000011';
  owner_id constant uuid := '16680000-0000-4000-8000-000000000001';
  accountant constant uuid := '16680000-0000-4000-8000-000000000002';
  staff_id constant uuid := '16680000-0000-4000-8000-000000000023';
  old_run constant uuid := '16680000-0000-4000-8000-000000000033';
  new_run constant uuid := '16680000-0000-4000-8000-000000000034';
  result jsonb; report jsonb; before_rows jsonb; after_rows jsonb;
BEGIN
  ASSERT current_database()='vinpoker_ops_l02';
  INSERT INTO public.staff(id,club_id,full_name,department,employment_type,monthly_salary_vnd)
    VALUES(staff_id,club,'L02 replaced run TEST','service','full_time',5000000);
  INSERT INTO public.staff_salary_runs(id,club_id,staff_id,period_year,period_month,employment_type,
    worked_days,gross_vnd,manual_bhxh_vnd,manual_tax_vnd,net_vnd,status,locked_by)
    VALUES(old_run,club,staff_id,2026,11,'full_time',26,5000000,0,0,5000000,'locked',owner_id);
  UPDATE public.staff_salary_runs SET status='voided' WHERE id=old_run;
  INSERT INTO public.staff_salary_runs(id,club_id,staff_id,period_year,period_month,employment_type,
    worked_days,gross_vnd,manual_bhxh_vnd,manual_tax_vnd,net_vnd,status,locked_by)
    VALUES(new_run,club,staff_id,2026,11,'full_time',26,5000000,0,0,5000000,'locked',owner_id);
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO before_rows
    FROM public.staff_salary_runs r WHERE r.id IN(old_run,new_run);
  PERFORM set_config('request.jwt.claim.sub',accountant::text,true);
  SET LOCAL ROLE authenticated;
  result:=public.mark_staff_salary_paid(old_run,'cash',NULL);
  ASSERT result->>'error'='STALE_SALARY_RUN',result::text;
  ASSERT result->>'run_id'=old_run::text AND result->>'status'='voided',result::text;
  report:=public.get_staff_salary_report(club,2026,11);
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'rows') r WHERE r->>'id'=old_run::text);
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'rows') r
    WHERE r->>'id'=new_run::text AND r->>'status'='locked' AND (r->>'net_vnd')::bigint=5000000);
  RESET ROLE;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO after_rows
    FROM public.staff_salary_runs r WHERE r.id IN(old_run,new_run);
  ASSERT after_rows=before_rows,'stale intent changed saved salary rows';
  ASSERT NOT EXISTS(SELECT 1 FROM public.staff_salary_runs WHERE id IN(old_run,new_run) AND status='paid');
END
$test$;
ROLLBACK;
