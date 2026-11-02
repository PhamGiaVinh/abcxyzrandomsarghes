-- Appended to operationalInventory.pg17.sql before its ROLLBACK by the
-- exact-local native parent. Fixture IDs are remapped together by the parent.
RESET ROLE;
UPDATE public.dealers SET employment_type='part_time',hourly_rate_vnd=60000,
 standard_hours_per_shift=8,manual_bhxh_vnd=0,manual_tax_vnd=0
WHERE id='e1700000-0000-4000-8000-000000000031';
UPDATE public.dealer_attendance SET check_in_time=now()-interval '2 hours',
 current_state=current_setting('test.closure_state')
WHERE id='e1700000-0000-4000-8000-000000000041';
CREATE TEMP TABLE closure_payroll_before AS
SELECT public.calculate_dealer_payroll('e1700000-0000-4000-8000-000000000031',current_date-1,current_date,0) payroll,
 (SELECT jsonb_build_object('check_in',check_in_time,'check_out',check_out_time,
   'worked',total_worked_minutes_today,'overtime',overtime_minutes)
  FROM public.dealer_attendance WHERE id='e1700000-0000-4000-8000-000000000041') time_fact;
SELECT set_config('request.jwt.claim.sub','e1700000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((public.operator_close_club_table_v2(
 'e1700000-0000-4000-8000-000000000021',1,'e1700000-0000-4000-8000-000000000077')->>'ok')::boolean,
 'close in the middle of work/rest succeeds');
RESET ROLE;
SELECT pg_temp.assert_true(
 (SELECT payroll=public.calculate_dealer_payroll('e1700000-0000-4000-8000-000000000031',current_date-1,current_date,0)
 FROM closure_payroll_before),'closing a table must not change attendance-based payroll');
SELECT pg_temp.assert_true(
 (SELECT time_fact=(SELECT jsonb_build_object('check_in',check_in_time,'check_out',check_out_time,
 'worked',total_worked_minutes_today,'overtime',overtime_minutes)
 FROM public.dealer_attendance WHERE id='e1700000-0000-4000-8000-000000000041')
 FROM closure_payroll_before),'no fabricated checkout, worked minutes or overtime');
SELECT pg_temp.assert_true((SELECT current_state=CASE current_setting('test.closure_state')
 WHEN 'assigned' THEN 'available' ELSE 'on_break' END AND check_out_time IS NULL
 FROM public.dealer_attendance WHERE id='e1700000-0000-4000-8000-000000000041'),
 'closing does not pull a resting dealer back to work');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_assignments
 WHERE table_session_id='e1700000-0000-4000-8000-000000000021' AND released_at IS NULL),
 'closed session has no live assignment');
-- Closed synthetic attendance spanning a VN midnight/month boundary. The open
-- attendance above is outside these dates; no payroll statement is finalized.
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,check_out_time,current_state)
VALUES(gen_random_uuid(),'e1700000-0000-4000-8000-000000000031','e1700000-0000-4000-8000-000000000030',
 '2026-09-30','checked_out','2026-09-30 23:30:00+07','2026-10-01 00:30:00+07','checked_out');
SELECT pg_temp.assert_true(
 (public.calculate_dealer_payroll('e1700000-0000-4000-8000-000000000031','2026-09-30','2026-09-30',0)->>'total_hours')::numeric=0.5
 AND (public.calculate_dealer_payroll('e1700000-0000-4000-8000-000000000031','2026-10-01','2026-10-01',0)->>'total_hours')::numeric=0.5,
 'overnight closed shift credits only 30 minutes to each VN day');
SELECT pg_temp.assert_true(
 (public.calculate_dealer_payroll('e1700000-0000-4000-8000-000000000031','2026-09-30','2026-10-01',0)->>'gross_pay_vnd')::numeric=60000,
 'one hour at the fixture rate is paid once across the month boundary');
SELECT 'CLOSE_DURING_'||upper(current_setting('test.closure_state'))||'_PAYROLL_AND_CLOCK_FACTS_UNCHANGED_LOCAL_PASS';
