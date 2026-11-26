-- Existing saved runs without contemporaneous source proof remain explicitly unverified.
BEGIN;
DO $test$
DECLARE
 owner_id constant uuid:='16810000-0000-4000-8000-000000000001';
 employee constant uuid:='16810000-0000-4000-8000-000000000004';
 club constant uuid:='16810000-0000-4000-8000-000000000011';
 v_staff constant uuid:='16810000-0000-4000-8000-000000000021';
 base_id constant uuid:='16810000-0000-4000-8000-000000000031';
 before_row jsonb; result jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_l02';
 INSERT INTO auth.users(id)VALUES(owner_id),(employee);
 INSERT INTO public.profiles(user_id,display_name)VALUES(owner_id,'L02 legacy owner TEST'),(employee,'L02 legacy employee TEST');
 INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES(club,owner_id,'L02 legacy source TEST','TEST','approved');
 INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,status)
 VALUES(v_staff,club,employee,'L02 legacy FT','service','full_time',5200000,'active');
 INSERT INTO public.staff_salary_periods(club_id,period_year,period_month,status,prepared_by,approved_by,approved_at)
 VALUES(club,2026,11,'approved',owner_id,owner_id,now());
 INSERT INTO public.staff_salary_runs(id,club_id,staff_id,period_year,period_month,employment_type,worked_days,gross_vnd,manual_bhxh_vnd,manual_tax_vnd,net_vnd,status,locked_by)
 VALUES(base_id,club,v_staff,2026,11,'full_time',25,5000000,0,0,5000000,'locked',owner_id);
 INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time)
 VALUES(v_staff,date'2026-11-26','checked_in',timestamptz'2026-11-26 09:00+07');
 SELECT to_jsonb(r) INTO before_row FROM public.staff_salary_runs r WHERE id=base_id;
 PERFORM set_config('request.jwt.claim.sub',employee::text,true);SET LOCAL ROLE authenticated;
 result:=public.staff_check_out(v_staff);ASSERT result->>'outcome'='checked_out',result::text;
 result:=public.get_staff_salary_run_source_v1(base_id);ASSERT result->>'source_status'='unverified' AND result->'source'='null'::jsonb,result::text;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 result:=public.refresh_staff_salary_adjustment_v1(base_id);ASSERT result->>'status'='unverified' AND result->>'reason'='LEGACY_SOURCE_UNVERIFIED',result::text;
 result:=public.get_staff_salary_adjustments_v1(club,2026,11);ASSERT result->'requests'='[]'::jsonb,result::text;
 RESET ROLE;
 ASSERT(SELECT to_jsonb(r) FROM public.staff_salary_runs r WHERE id=base_id)=before_row;
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.staff_salary_sources_v1 WHERE run_id=base_id),'legacy proof fabricated';
 ASSERT NOT EXISTS(SELECT 1 FROM public.staff_salary_runs WHERE adjusts_id=base_id),'legacy amount recomputed';
END $test$;
ROLLBACK;
