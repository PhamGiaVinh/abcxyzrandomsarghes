-- Canonical PT daily receipt -> monthly summary -> employee; no second payable.
-- Two-connection PT race proof is retained separately with the runtime receipt.
BEGIN;
DO $test$
DECLARE
  owner_id constant uuid := '16730000-0000-4000-8000-000000000001';
  employee constant uuid := '16730000-0000-4000-8000-000000000004';
  club constant uuid := '16730000-0000-4000-8000-000000000011';
  v_staff_id constant uuid := '16730000-0000-4000-8000-000000000021';
  yr integer := extract(year from now()); mon integer := extract(month from now());
  first_receipt jsonb; result jsonb; report jsonb; self_report jsonb;
  payment_before jsonb; payment_after jsonb; month_before jsonb; month_after jsonb;
  month_id uuid; zero_balance_refused boolean := false;
BEGIN
  ASSERT current_database()='vinpoker_ops_l02';
  INSERT INTO auth.users(id) VALUES(owner_id),(employee);
  INSERT INTO public.profiles(user_id,display_name)
    VALUES(owner_id,'L02 PT owner TEST'),(employee,'L02 PT employee TEST');
  INSERT INTO public.clubs(id,owner_id,name,region,status)
    VALUES(club,owner_id,'L02 PT700k TEST','TEST','approved');
  INSERT INTO public.staff(id,club_id,user_id,full_name,department,employment_type,hourly_rate_vnd,status)
    VALUES(v_staff_id,club,employee,'L02 PT700k','service','part_time',70000,'active');
  INSERT INTO public.staff_attendance(staff_id,shift_date,status,check_in_time,check_out_time,total_worked_minutes_today)
    VALUES(v_staff_id,current_date,'checked_out',now()-interval '12 hours',now()-interval '2 hours',600);
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SET LOCAL ROLE authenticated;
  first_receipt:=public.pay_staff_pt_balance(v_staff_id,'cash',NULL,'L02-PT700K-TEST',NULL);
  ASSERT (first_receipt->>'amount_vnd')::bigint=700000,first_receipt::text;
  ASSERT (first_receipt->>'minutes_paid')::integer=600,first_receipt::text;
  result:=public.pay_staff_pt_balance(v_staff_id,'cash',NULL,'L02-PT700K-TEST',NULL);
  ASSERT result->>'idempotent'='true' AND result->>'payment_id'=first_receipt->>'payment_id',result::text;
  BEGIN
    PERFORM public.pay_staff_pt_balance(v_staff_id,'cash',NULL,'L02-PT700K-NEW-KEY',NULL);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Số dư bằng 0%' THEN RAISE; END IF;
    zero_balance_refused:=true;
  END;
  ASSERT zero_balance_refused,'new request key paid the closed attendance twice';
  result:=public.chot_staff_salary_month(club,yr,mon);
  ASSERT (result->>'locked_now')::integer=1 AND (result->>'total_net_vnd')::bigint=700000,result::text;
  result:=public.submit_staff_salary_month(club,yr,mon,'L02 PT700k TEST');
  ASSERT result->>'status'='submitted',result::text;
  result:=public.approve_staff_salary_month(club,yr,mon);
  ASSERT result->>'status'='approved',result::text;
  report:=public.get_staff_salary_report(club,yr,mon);
  ASSERT jsonb_array_length(report->'rows')=1,report::text;
  ASSERT report->'rows'->0->>'employment_type'='part_time';
  ASSERT (report->'rows'->0->>'net_vnd')::bigint=700000;
  ASSERT (report->'rows'->0->>'worked_minutes')::integer=600;
  month_id:=(report->'rows'->0->>'id')::uuid;
  RESET ROLE;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO payment_before
    FROM public.staff_pt_wage_payments p WHERE p.staff_id=v_staff_id;
  ASSERT jsonb_array_length(payment_before)=1;
  SELECT to_jsonb(r) INTO month_before FROM public.staff_salary_runs r WHERE r.id=month_id;
  SET LOCAL ROLE authenticated;
  result:=public.mark_staff_salary_paid(month_id,'cash',NULL);
  ASSERT result->>'error'='PT_MONTHLY_PAYMENT_SUMMARY_ONLY',result::text;
  result:=public.chot_staff_salary_month(club,yr,mon);
  ASSERT (result->>'locked_now')::integer=0 AND (result->>'total_net_vnd')::bigint=700000,result::text;
  PERFORM set_config('request.jwt.claim.sub',employee::text,true);
  self_report:=public.get_my_staff_salary(v_staff_id);
  ASSERT (self_report->>'balance_vnd')::bigint=0,self_report::text;
  ASSERT jsonb_array_length(self_report->'recent_payments')=1,self_report::text;
  ASSERT self_report->'recent_payments'->0->>'id'=first_receipt->>'payment_id';
  ASSERT (self_report->'recent_payments'->0->>'amount_vnd')::bigint=700000;
  RESET ROLE;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO payment_after
    FROM public.staff_pt_wage_payments p WHERE p.staff_id=v_staff_id;
  SELECT to_jsonb(r) INTO month_after FROM public.staff_salary_runs r WHERE r.id=month_id;
  ASSERT payment_after=payment_before,'monthly actions changed daily receipts';
  ASSERT month_after=month_before,'monthly summary became another payment';
END
$test$;
ROLLBACK;
