\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
INSERT INTO auth.users(id) VALUES('e2a90000-0000-4000-8000-000000000001');
INSERT INTO public.staff(id,user_id,club_id,full_name,department,employment_type,hourly_rate_vnd,status)
VALUES('e2a90000-0000-4000-8000-000000000002','e2a90000-0000-4000-8000-000000000001',
 '9755fe63-669c-49d0-bea9-75177a3d30fc','Staff self salary local TEST','service','part_time',50000,'active');
INSERT INTO public.staff_attendance(id,staff_id,shift_date,status,check_in_time,check_out_time)
VALUES('e2a90000-0000-4000-8000-000000000003','e2a90000-0000-4000-8000-000000000002',
 current_date,'checked_out',now()-interval '8 hours',now());
SET LOCAL request.jwt.claim.sub='e2a90000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"e2a90000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; first_receipt jsonb; repeated_receipt jsonb; out_receipt jsonb;BEGIN
 IF (SELECT count(*) FROM public.staff_attendance WHERE staff_id='e2a90000-0000-4000-8000-000000000002')<>1 THEN
  RAISE EXCEPTION 'staff_self_attendance_select_missing';END IF;
 first_receipt:=public.staff_check_in('e2a90000-0000-4000-8000-000000000002');
 repeated_receipt:=public.staff_check_in('e2a90000-0000-4000-8000-000000000002');
 IF first_receipt->>'outcome' IS DISTINCT FROM 'checked_in'
  OR first_receipt->>'attendance_id' IS NULL
  OR repeated_receipt->>'outcome' IS DISTINCT FROM 'already_checked_in'
  OR repeated_receipt->>'attendance_id' IS DISTINCT FROM first_receipt->>'attendance_id' THEN
  RAISE EXCEPTION 'native_staff_checkin_receipt_mismatch';END IF;
 out_receipt:=public.staff_check_out('e2a90000-0000-4000-8000-000000000002');
 IF out_receipt->>'outcome' IS DISTINCT FROM 'checked_out'
  OR out_receipt->>'attendance_id' IS DISTINCT FROM first_receipt->>'attendance_id'
  OR out_receipt->>'check_out_time' IS NULL
  OR (out_receipt->>'total_worked_minutes_today')::integer IS DISTINCT FROM 0 THEN
  RAISE EXCEPTION 'native_staff_checkout_receipt_mismatch';END IF;
 r:=public.staff_check_out('e2a90000-0000-4000-8000-000000000002');
 IF r->>'outcome' IS DISTINCT FROM 'no_open_shift' THEN
  RAISE EXCEPTION 'native_staff_no_open_receipt_mismatch';END IF;
 r:=public.get_my_staff_salary('e2a90000-0000-4000-8000-000000000002');
 IF r->>'staff_id' IS DISTINCT FROM 'e2a90000-0000-4000-8000-000000000002'
  OR r->>'club_id' IS DISTINCT FROM '9755fe63-669c-49d0-bea9-75177a3d30fc'
  OR r->>'employment_type' IS DISTINCT FROM 'part_time'
  OR (r->>'accrued_minutes')::numeric<>480 OR (r->>'balance_vnd')::numeric<>400000
  OR r->>'current_shift_open' IS DISTINCT FROM 'false' OR r->'recent_payments' IS DISTINCT FROM '[]'::jsonb
  OR r->'monthly_salary_vnd' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'native_staff_salary_contract_mismatch:%',r;END IF;
END $$;
RESET ROLE;
UPDATE public.staff SET status='inactive' WHERE id='e2a90000-0000-4000-8000-000000000002';
-- Preserve the existing rule: inactive staff cannot start a new shift but
-- may close an already-open one; the writer still caps a forgotten shift24h.
INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time)
VALUES('e2a90000-0000-4000-8000-000000000002',current_date-1,'checked_in',now()-interval '26 hours');
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; denied boolean:=false;BEGIN
 BEGIN PERFORM public.staff_check_in('e2a90000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'inactive_staff_checkin_allowed';END IF;
 r:=public.staff_check_out('e2a90000-0000-4000-8000-000000000002');
 IF r->>'outcome' IS DISTINCT FROM 'checked_out'
  OR (r->>'total_worked_minutes_today')::integer IS DISTINCT FROM 1440 THEN
  RAISE EXCEPTION 'inactive_staff_checkout_or_24h_cap_changed';END IF;
 r:=public.get_my_staff_salary('e2a90000-0000-4000-8000-000000000002');
 IF r->>'error' IS DISTINCT FROM 'staff not found or inactive' OR r ? 'balance_vnd' THEN
  RAISE EXCEPTION 'native_inactive_staff_error_contract_changed:%',r;END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
SET LOCAL request.jwt.claims='{"sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 IF EXISTS(SELECT 1 FROM public.staff_attendance WHERE staff_id='e2a90000-0000-4000-8000-000000000002') THEN
  RAISE EXCEPTION 'outsider_staff_attendance_select_allowed';END IF;
 BEGIN PERFORM public.get_my_staff_salary('e2a90000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider_staff_salary_read_allowed';END IF;
 denied:=false;
 BEGIN PERFORM public.staff_check_out('e2a90000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider_staff_checkout_allowed';END IF;
 denied:=false;
 BEGIN PERFORM public.staff_check_in('e2a90000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider_staff_checkin_allowed';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.get_my_staff_salary(uuid)','EXECUTE') THEN RAISE EXCEPTION 'anonymous_staff_salary_granted';END IF;
 IF has_function_privilege('anon','public.staff_check_out(uuid)','EXECUTE')
  OR has_function_privilege('anon','public.staff_check_in(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'anonymous_staff_attendance_writer_granted';END IF;
END $$;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.staff_check_out('e2a90000-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'missing_actor_staff_checkout_allowed';END IF;
END $$;
RESET ROLE;
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.staff WHERE id='e2a90000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'staff_fixture_not_rolled_back';END IF;
END $$;
SELECT 'STAFF_SELF_SALARY_NATIVE_ACTIVE_INACTIVE_OUTSIDER_ROLLBACK_PASS';
