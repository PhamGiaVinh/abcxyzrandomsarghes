-- Controlled source-revision fixture: preserve old request payload and reject its stale approval.
BEGIN;
DO $test$
DECLARE
 owner_id constant uuid:='16790000-0000-4000-8000-000000000001';
 employee constant uuid:='16790000-0000-4000-8000-000000000004';
 club constant uuid:='16790000-0000-4000-8000-000000000011';
 v_staff constant uuid:='16790000-0000-4000-8000-000000000021';
 result jsonb; base_id uuid; old_id uuid; current_id uuid; old_payload jsonb; after_payload jsonb;
BEGIN
 ASSERT current_database()='vinpoker_ops_l02';
 INSERT INTO auth.users(id)VALUES(owner_id),(employee);
 INSERT INTO public.profiles(user_id,display_name)VALUES(owner_id,'L02 revision owner TEST'),(employee,'L02 revision employee TEST');
 INSERT INTO public.clubs(id,owner_id,name,region,status)VALUES(club,owner_id,'L02 adjustment revision TEST','TEST','approved');
 INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,monthly_salary_vnd,manual_bhxh_vnd,manual_tax_vnd,status)
 VALUES(v_staff,club,employee,'L02 revision FT','service','full_time',5200000,0,0,'active');
 INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time,check_out_time)
 SELECT v_staff,date'2026-11-01'+d,'checked_out',(date'2026-11-01'+d+time'09:00')AT TIME ZONE'Asia/Ho_Chi_Minh',(date'2026-11-01'+d+time'17:00')AT TIME ZONE'Asia/Ho_Chi_Minh' FROM generate_series(0,24)d;
 INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time)VALUES(v_staff,date'2026-11-26','checked_in',timestamptz'2026-11-26 09:00+07');
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);SET LOCAL ROLE authenticated;
 PERFORM public.chot_staff_salary_month(club,2026,11);PERFORM public.submit_staff_salary_month(club,2026,11,NULL);PERFORM public.approve_staff_salary_month(club,2026,11);
 RESET ROLE;SELECT id INTO base_id FROM public.staff_salary_runs WHERE staff_id=v_staff;
 PERFORM set_config('request.jwt.claim.sub',employee::text,true);SET LOCAL ROLE authenticated;PERFORM public.staff_check_out(v_staff);
 RESET ROLE;
 SELECT id,to_jsonb(q)-ARRAY['state','superseded_at','superseded_reason','approved_at','approved_by','child_run_id'] INTO old_id,old_payload
 FROM floor_private.staff_salary_adjustment_requests_v1 q WHERE base_run_id=base_id AND state='pending';
 ASSERT old_id IS NOT NULL;
 -- This is a fixture correction, not a claim that an operator correction UI exists.
 UPDATE public.staff_attendance SET check_out_time=check_out_time-interval '1 second' WHERE staff_id=v_staff AND shift_date=date'2026-11-26';
 SELECT id INTO current_id FROM floor_private.staff_salary_adjustment_requests_v1 WHERE base_run_id=base_id AND state='pending';
 ASSERT current_id IS NOT NULL AND current_id<>old_id,'source revision reused old approval request';
 SELECT to_jsonb(q)-ARRAY['state','superseded_at','superseded_reason','approved_at','approved_by','child_run_id'] INTO after_payload
 FROM floor_private.staff_salary_adjustment_requests_v1 q WHERE id=old_id;
 ASSERT after_payload=old_payload,'old request payload was rewritten';
 ASSERT(SELECT state FROM floor_private.staff_salary_adjustment_requests_v1 WHERE id=old_id)='superseded';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);SET LOCAL ROLE authenticated;
 result:=public.approve_staff_salary_adjustment_v1(old_id);ASSERT result->>'error'='STALE_SALARY_ADJUSTMENT',result::text;
 RESET ROLE;ASSERT NOT EXISTS(SELECT 1 FROM public.staff_salary_runs WHERE adjusts_id=base_id),'stale approval created payable';
 SET LOCAL ROLE authenticated;
 result:=public.approve_staff_salary_adjustment_v1(current_id);ASSERT result->>'status'='approved' AND(result->>'amount_vnd')::bigint=200000;
 result:=public.approve_staff_salary_adjustment_v1(old_id);ASSERT result->>'error'='STALE_SALARY_ADJUSTMENT';
 RESET ROLE;
 ASSERT(SELECT count(*) FROM public.staff_salary_runs WHERE adjusts_id=base_id)=1;
 ASSERT(SELECT sum(net_vnd) FROM public.staff_salary_runs WHERE staff_id=v_staff)=5200000;
 ASSERT(SELECT count(*) FROM public.staff_salary_runs WHERE staff_id=v_staff AND status='paid')=0;
END $test$;
ROLLBACK;
