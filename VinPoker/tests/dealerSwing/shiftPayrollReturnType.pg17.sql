\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres' THEN
  RAISE EXCEPTION 'isolated_shift_payroll_test_required';END IF;
END $$;
INSERT INTO auth.users(id) VALUES('e1830000-0000-4000-8000-000000000001'),
 ('e1830000-0000-4000-8000-000000000004');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1830000-0000-4000-8000-000000000002',
 'e1830000-0000-4000-8000-000000000001','Shift payroll return TEST','TEST');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('e1830000-0000-4000-8000-000000000003',
 'e1830000-0000-4000-8000-000000000002','Synthetic shift payroll TEST','active');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='e1830000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.get_shift_payroll_summary('e1830000-0000-4000-8000-000000000002',current_date))<>0 THEN
  RAISE EXCEPTION 'shift_payroll_empty_result_failed';END IF;
END $$;
RESET ROLE;
INSERT INTO public.dealer_attendance(id,dealer_id,shift_date,status,check_in_time,check_out_time,overtime_minutes)
 VALUES('e1830000-0000-4000-8000-000000000005','e1830000-0000-4000-8000-000000000003',
 current_date,'checked_out',current_date+time '08:00',current_date+time '10:00',7);
CREATE TEMP TABLE expected_pay AS
 SELECT COALESCE(p.base_rate,100000) AS base,7*COALESCE(p.overtime_rate,2000) AS ot
 FROM public.dealers d LEFT JOIN public.dealer_pay_rates p ON p.club_id=d.club_id AND p.tier=d.tier
 WHERE d.id='e1830000-0000-4000-8000-000000000003';
GRANT SELECT ON TABLE pg_temp.expected_pay TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result record; expected_base numeric; expected_ot numeric;BEGIN
 SELECT base,ot INTO STRICT expected_base,expected_ot FROM pg_temp.expected_pay;
 SELECT * INTO STRICT result FROM public.get_shift_payroll_summary('e1830000-0000-4000-8000-000000000002',current_date);
 IF result.total_minutes IS DISTINCT FROM 120 OR result.overtime_minutes IS DISTINCT FROM 7
  OR result.tables_served IS DISTINCT FROM 0 OR result.swings_done IS DISTINCT FROM 0
  OR result.base_pay IS DISTINCT FROM expected_base OR result.overtime_pay IS DISTINCT FROM expected_ot THEN
  RAISE EXCEPTION 'shift_payroll_type_or_existing_calculation_changed';END IF;
END $$;
SET LOCAL request.jwt.claim.sub='e1830000-0000-4000-8000-000000000004';
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.get_shift_payroll_summary('e1830000-0000-4000-8000-000000000002',current_date);
  RAISE EXCEPTION 'shift_payroll83_cross_club_admitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
-- Keep two attendance lifecycles in one day, as the existing schema supports.
UPDATE public.dealer_attendance SET overtime_minutes=2147483647 WHERE id='e1830000-0000-4000-8000-000000000005';
INSERT INTO public.dealer_attendance(id,dealer_id,shift_date,status,check_in_time,check_out_time,overtime_minutes)
 VALUES('e1830000-0000-4000-8000-000000000006','e1830000-0000-4000-8000-000000000003',
 current_date,'checked_out',current_date+time '11:00',current_date+time '12:00',1);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1830000-0000-4000-8000-000000000001';
DO $$ BEGIN
 BEGIN
  PERFORM * FROM public.get_shift_payroll_summary('e1830000-0000-4000-8000-000000000002',current_date);
  RAISE EXCEPTION 'shift_payroll83_overflow_hidden';
 EXCEPTION WHEN numeric_value_out_of_range THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
\echo SHIFT_PAYROLL83_TYPE_EXISTING_CALCULATION_TENANT_AND_OVERFLOW_PASS
