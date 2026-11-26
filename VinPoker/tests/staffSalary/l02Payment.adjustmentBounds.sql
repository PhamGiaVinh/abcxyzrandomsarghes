-- Keep cumulative gross/net correct when frozen deductions clipped the original net to zero.
BEGIN;
DO $test$
DECLARE
 owner_id constant uuid:='16780000-0000-4000-8000-000000000001';
 employee constant uuid:='16780000-0000-4000-8000-000000000004';
 club constant uuid:='16780000-0000-4000-8000-000000000011';
 v_staff constant uuid:='16780000-0000-4000-8000-000000000021';
 result jsonb; request_id uuid; child_id uuid; base_id uuid;
BEGIN
 ASSERT current_database()='vinpoker_ops_l02';
 INSERT INTO auth.users(id)VALUES(owner_id),(employee);
 INSERT INTO public.profiles(user_id,display_name)VALUES(owner_id,'L02 deduction owner TEST'),(employee,'L02 deduction employee TEST');
 INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES(club,owner_id,'L02 deduction TEST','TEST','approved');
 INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status)
 VALUES(v_staff,club,employee,'L02 deduction FT','service','full_time',5200000,5100000,0,'active');
 INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time,check_out_time)
 SELECT v_staff,date'2026-11-01'+d,'checked_out',(date'2026-11-01'+d+time'09:00')AT TIME ZONE'Asia/Ho_Chi_Minh',(date'2026-11-01'+d+time'17:00')AT TIME ZONE'Asia/Ho_Chi_Minh' FROM generate_series(0,24)d;
 INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time)VALUES(v_staff,date'2026-11-26','checked_in',timestamptz'2026-11-26 09:00+07');
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);SET LOCAL ROLE authenticated;
 result:=public.chot_staff_salary_month(club,2026,11);ASSERT(result->>'total_net_vnd')::bigint=0,result::text;
 PERFORM public.submit_staff_salary_month(club,2026,11,NULL);PERFORM public.approve_staff_salary_month(club,2026,11);
 RESET ROLE;SELECT id INTO base_id FROM public.staff_salary_runs WHERE staff_id=v_staff;
 -- Today's rate/deductions must not rewrite the frozen period policy used by late work.
 UPDATE public.staff SET monthly_salary_vnd=6500000,manual_bhxh_vnd=0 WHERE id=v_staff;
 PERFORM set_config('request.jwt.claim.sub',employee::text,true);SET LOCAL ROLE authenticated;
 result:=public.staff_check_out(v_staff);ASSERT result->>'outcome'='checked_out';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 result:=public.get_staff_salary_adjustments_v1(club,2026,11);
 ASSERT jsonb_array_length(result->'requests')=1,result::text;
 ASSERT(result->'requests'->0->>'amount_vnd')::bigint=100000,result::text;
 ASSERT(result->'requests'->0->>'gross_delta_vnd')::bigint=200000,result::text;
 request_id:=(result->'requests'->0->>'id')::uuid;
 result:=public.approve_staff_salary_adjustment_v1(request_id);child_id:=(result->>'run_id')::uuid;
 result:=public.mark_staff_salary_paid(child_id,'cash',NULL);ASSERT(result->>'net_vnd')::bigint=100000,result::text;
 result:=public.get_club_finance_summary(timestamptz'2026-11-01 00:00+07',timestamptz'2026-11-30 23:59:59+07',club);
 ASSERT(result->'cost'->>'payrollGross')::bigint=5200000 AND(result->'cost'->>'payrollNet')::bigint=100000,result::text;
 RESET ROLE;
 ASSERT(SELECT gross_vnd FROM public.staff_salary_runs WHERE id=base_id)=5000000;
 ASSERT(SELECT net_vnd FROM public.staff_salary_runs WHERE id=base_id)=0;
 ASSERT(SELECT manual_bhxh_vnd FROM public.staff_salary_runs WHERE id=base_id)=5100000;
 ASSERT(SELECT gross_vnd FROM public.staff_salary_runs WHERE id=child_id)=200000;
 ASSERT(SELECT net_vnd FROM public.staff_salary_runs WHERE id=child_id)=100000;
END $test$;
ROLLBACK;
