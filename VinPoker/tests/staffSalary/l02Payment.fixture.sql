BEGIN;
DO $fixture$
DECLARE
  a constant uuid := '16680000-0000-4000-8000-000000000001';
  b constant uuid := '16680000-0000-4000-8000-000000000002';
  club constant uuid := '16680000-0000-4000-8000-000000000011';
  staff constant uuid := '16680000-0000-4000-8000-000000000021';
  obligation constant uuid := '16680000-0000-4000-8000-000000000031';
  result jsonb;
BEGIN
  ASSERT current_database() = 'vinpoker_ops_l02';
  INSERT INTO auth.users(id) VALUES (a),(b);
  INSERT INTO public.profiles(user_id,display_name) VALUES (a,'L02 owner'),(b,'L02 accountant');
  INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES (club,a,'L02 TEST','TEST','approved');
  INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES (club,b,a);
  INSERT INTO public.staff(id,club_id,full_name,department,employment_type,monthly_salary_vnd)
    VALUES(staff,club,'L02 FT','service','full_time',5000000);
  INSERT INTO public.staff_salary_runs(id,club_id,staff_id,period_year,period_month,employment_type,
    worked_days,gross_vnd,manual_bhxh_vnd,manual_tax_vnd,net_vnd,status,locked_by)
    VALUES(obligation,club,staff,2026,11,'full_time',26,5000000,0,0,5000000,'locked',a);
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  SET LOCAL ROLE authenticated;
  result := public.mark_staff_salary_paid(obligation,'cash',NULL);
  ASSERT result->>'error' = 'NOT_APPROVED';
  RESET ROLE;
  ASSERT (SELECT status FROM public.staff_salary_runs WHERE id=obligation) = 'locked';
  INSERT INTO public.staff_salary_periods(club_id,period_year,period_month,status,prepared_by,prepared_at,approved_by,approved_at)
    VALUES(club,2026,11,'approved',a,now(),a,now());
END
$fixture$;
COMMIT;
