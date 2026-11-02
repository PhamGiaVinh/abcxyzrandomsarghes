-- Read-only regression for the exact original local canary. Never finalizes pay.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
  OR host(inet_server_addr())<>'127.0.0.1' THEN RAISE EXCEPTION 'isolated_native_only';END IF;
END $$;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN
  PERFORM public.calculate_dealer_payroll('0d617281-35e5-43cc-87f2-86e5094bc403','2026-10-18','2026-10-18');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'ANONYMOUS_DIRECT_PAYROLL_EXPOSED';END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='50e5437a-9b82-4b60-8f70-dac066deecc9';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"50e5437a-9b82-4b60-8f70-dac066deecc9"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN
  PERFORM public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'OUTSIDER_CLUB_PAYROLL_EXPOSED';END IF;
 denied:=false;
 BEGIN
  PERFORM public.calculate_dealer_payroll('0d617281-35e5-43cc-87f2-86e5094bc403','2026-10-18','2026-10-18');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'AUTHENTICATED_DIRECT_PAYROLL_EXPOSED';END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; envelope jsonb;BEGIN
 envelope:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18');
 IF envelope->>'club_id' IS DISTINCT FROM '9ef80c7a-cb97-4acc-b81c-5bf34d49317f'
   OR envelope->>'period_start' IS DISTINCT FROM '2026-10-18'
   OR envelope->>'period_end' IS DISTINCT FROM '2026-10-18'
   OR jsonb_typeof(envelope->'dealers') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'PAYROLL_NATIVE_READ_ENVELOPE_MISMATCH'; END IF;
 result:=envelope->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
 IF result->>'standard_shifts_per_month' IS DISTINCT FROM '26'
  OR (result->>'net_pay_vnd') IS NULL OR (result->>'base_salary_vnd') IS DISTINCT FROM '0'
  OR (result->>'bhxh_base_vnd') IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'MISSING_CLUB_SETTINGS_NULL_PAYROLL_OR_SPURIOUS_INSURANCE';END IF;
END $$;
ROLLBACK;
SELECT 'DIRECT_PAYROLL_PRIVATE_OWNER_PREVIEW_DEFAULTS_PASS';

-- Settings variations are temporary fixture configuration; rollback keeps the
-- exact original club and all payroll records unchanged.
BEGIN;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}';
DO $$ DECLARE result jsonb;value integer;BEGIN
 IF EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f') THEN
  RAISE EXCEPTION 'missing_settings_fixture_changed';END IF;
 INSERT INTO public.club_settings(club_id,standard_shifts_per_month)
  VALUES('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',30);
 result:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18')
  ->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
 IF result->>'standard_shifts_per_month' IS DISTINCT FROM '30' OR result->>'net_pay_vnd' IS DISTINCT FROM '0' THEN
  RAISE EXCEPTION 'valid_settings_overridden_or_zero_salary_changed';END IF;
 IF (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='club_settings' AND column_name='standard_shifts_per_month')='YES' THEN
  UPDATE public.club_settings SET standard_shifts_per_month=NULL WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f';
  result:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18')
   ->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
  IF result->>'standard_shifts_per_month' IS DISTINCT FROM '26' OR result->>'net_pay_vnd' IS DISTINCT FROM '0' THEN
   RAISE EXCEPTION 'null_settings_default_failed';END IF;
 END IF;
END $$;
ROLLBACK;
SELECT 'PAYROLL_VALID_AND_NULL_SETTINGS_ROLLBACK_PASS';

BEGIN;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494"}';
DO $$ DECLARE result jsonb;BEGIN
 UPDATE public.dealers SET employment_type='full_time',monthly_salary_vnd=7800000,
  hourly_rate_vnd=50000,standard_hours_per_shift=8,manual_bhxh_vnd=NULL,manual_tax_vnd=NULL
  WHERE id='0d617281-35e5-43cc-87f2-86e5094bc403';
 result:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-19')
  ->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
 IF (result->>'base_salary_vnd')::bigint<>300000 OR (result->>'gross_pay_vnd')::bigint<>300000
  OR (result->>'net_pay_vnd')::bigint<>268500 OR (result->>'total_hours')::numeric<>8 THEN
  RAISE EXCEPTION 'full_time_existing_formula_regressed: %',result;END IF;
 UPDATE public.dealers SET employment_type='part_time' WHERE id='0d617281-35e5-43cc-87f2-86e5094bc403';
 result:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-19')
  ->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
 IF (result->>'base_salary_vnd')::bigint<>0 OR (result->>'gross_pay_vnd')::bigint<>400000
  OR (result->>'net_pay_vnd')::bigint<>400000 OR (result->>'total_hours')::numeric<>8 THEN
  RAISE EXCEPTION 'part_time_existing_formula_regressed: %',result;END IF;
END $$;
ROLLBACK;
SELECT 'PAYROLL_NONZERO_FT_PT_EXISTING_FORMULAS_PASS';

BEGIN;
DO $$ DECLARE outsider uuid:=gen_random_uuid();denied boolean:=false;BEGIN
 INSERT INTO auth.users(id) VALUES(outsider);
 INSERT INTO public.user_roles(user_id,role) VALUES(outsider,'club_admin');
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
  PERFORM public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 RESET ROLE;
 IF NOT denied THEN RAISE EXCEPTION 'GLOBAL_CLUB_ADMIN_CROSSES_PAYROLL_TENANT';END IF;
 -- Explicit club delegation must continue to work after rejecting the global
 -- label alone. This temporary role/link is rolled back with the whole case.
 INSERT INTO public.club_dealer_controls(club_id,user_id)
  VALUES('9ef80c7a-cb97-4acc-b81c-5bf34d49317f',outsider);
 SET LOCAL ROLE authenticated;
 IF public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-18')->>'club_id'
  IS DISTINCT FROM '9ef80c7a-cb97-4acc-b81c-5bf34d49317f' THEN
  RAISE EXCEPTION 'explicit_club_dealer_control_lost_access';END IF;
 RESET ROLE;
END $$;
ROLLBACK;
SELECT 'PAYROLL_GLOBAL_ROLE_IS_NOT_CLUB_AUTHORITY_PASS';

-- Synthetic saved data only, always rolled back; never finalize a real period.
BEGIN;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
DO $$ DECLARE period uuid:=gen_random_uuid();saved uuid:=gen_random_uuid();before_row jsonb;result jsonb;BEGIN
 IF EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f'
  AND period_start='2026-10-18' AND period_end='2026-10-19') THEN RAISE EXCEPTION 'saved_fixture_period_collision';END IF;
 INSERT INTO public.payroll_periods(id,club_id,period_start,period_end,period_month,period_year,status)
 VALUES(period,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-19',10,2026,'draft');
 INSERT INTO public.dealer_payroll(id,period_id,club_id,dealer_id,employment_type,status,
  gross_pay_vnd,net_pay_after_tax_vnd,net_pay_vnd,total_hours)
 VALUES(saved,period,'9ef80c7a-cb97-4acc-b81c-5bf34d49317f','0d617281-35e5-43cc-87f2-86e5094bc403',
  'part_time','pending',432100,398700,398700,7);
 SELECT to_jsonb(dp) INTO before_row FROM public.dealer_payroll dp WHERE id=saved;
 UPDATE public.dealers SET hourly_rate_vnd=123456,monthly_salary_vnd=9999999
 WHERE id='0d617281-35e5-43cc-87f2-86e5094bc403';
 SET LOCAL ROLE authenticated;
 IF NOT EXISTS(SELECT 1 FROM public.payroll_periods p WHERE p.id=period
   AND p.club_id='9ef80c7a-cb97-4acc-b81c-5bf34d49317f' AND p.period_year=2026 AND p.period_month=10 AND p.status='draft')
   OR NOT EXISTS(SELECT 1 FROM public.dealer_payroll dp WHERE dp.period_id=period AND dp.id=saved
     AND dp.gross_pay_vnd=432100 AND dp.net_pay_vnd=398700) THEN
   RAISE EXCEPTION 'PAYROLL_OWNER_SAVED_READ_PATH_UNAVAILABLE';END IF;
 result:=public.calculate_club_payroll('9ef80c7a-cb97-4acc-b81c-5bf34d49317f','2026-10-18','2026-10-19')
  ->'dealers'->'0d617281-35e5-43cc-87f2-86e5094bc403';
 RESET ROLE;
 IF result->>'gross_pay_vnd' IS DISTINCT FROM '432100' OR result->>'net_pay_vnd' IS DISTINCT FROM '398700'
  OR (result->>'total_hours')::numeric IS DISTINCT FROM 7::numeric THEN RAISE EXCEPTION 'saved_payroll_recalculated: %',result;END IF;
 IF (SELECT to_jsonb(dp) FROM public.dealer_payroll dp WHERE id=saved) IS DISTINCT FROM before_row THEN
  RAISE EXCEPTION 'saved_payroll_mutated';END IF;
END $$;
ROLLBACK;
SELECT 'PAYROLL_SAVED_AMOUNTS_IMMUTABLE_PASS';

BEGIN;
REVOKE EXECUTE ON FUNCTION public.calculate_club_payroll(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.calculate_club_payroll(uuid,date,date)','EXECUTE')
  OR has_function_privilege('anon','public.calculate_club_payroll(uuid,date,date)','EXECUTE')
  OR has_function_privilege('service_role','public.calculate_club_payroll(uuid,date,date)','EXECUTE')
  OR has_function_privilege('authenticated','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'payroll_containment_failed';END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.calculate_club_payroll(uuid,date,date)','EXECUTE')
  OR has_function_privilege('authenticated','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'containment_rehearsal_not_restored';END IF;
END $$;
SELECT 'PAYROLL_PREVIEW_CONTAINMENT_ROLLBACK_PASS';
