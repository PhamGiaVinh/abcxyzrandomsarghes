\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.dealers d JOIN public.clubs c ON c.id=d.club_id
   WHERE d.id='670eb72b-5f5c-43fc-83ff-f9d5f6a7c026' AND d.user_id IS NULL
   AND d.full_name='Payroll browser PT TEST' AND c.id='9755fe63-669c-49d0-bea9-75177a3d30fc'
   AND c.name='Payroll browser local TEST' AND c.owner_id='73a8f9b8-2050-4b09-a7ed-2c6a28342279') THEN
  RAISE EXCEPTION 'independent_payroll_canary_changed'; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- Temporary synthetic linkage only, rolled back; no production/role mutation.
UPDATE public.dealers SET user_id='73a8f9b8-2050-4b09-a7ed-2c6a28342279'
WHERE id='670eb72b-5f5c-43fc-83ff-f9d5f6a7c026';
SET LOCAL request.jwt.claim.sub='73a8f9b8-2050-4b09-a7ed-2c6a28342279';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"73a8f9b8-2050-4b09-a7ed-2c6a28342279","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE pt jsonb;saved jsonb; BEGIN
 pt:=public.get_my_pt_wage('670eb72b-5f5c-43fc-83ff-f9d5f6a7c026');
 IF pt->>'employment_type' IS DISTINCT FROM 'part_time' OR (pt->>'hourly_rate_vnd')::numeric<>50000
   OR pt->>'balance_vnd' IS NULL THEN RAISE EXCEPTION 'native_pt_self_payload_invalid:%',pt; END IF;
 saved:=public.get_my_dealer_payroll('670eb72b-5f5c-43fc-83ff-f9d5f6a7c026',2026,10);
 IF saved->>'has_data' IS DISTINCT FROM 'true' OR saved->>'period_status' IS DISTINCT FROM 'draft'
   OR (saved->>'net_pay_vnd')::numeric<>400000 THEN RAISE EXCEPTION 'native_saved_self_payload_invalid:%',saved; END IF;
 RAISE NOTICE 'NATIVE_SAVED_SELF_READ_CAN_CONTAIN_UNFINALIZED_DRAFT';
END $$;
RESET ROLE;
UPDATE public.dealers SET status='inactive' WHERE id='670eb72b-5f5c-43fc-83ff-f9d5f6a7c026';
SET LOCAL ROLE authenticated;
DO $$ DECLARE inactive jsonb;BEGIN
 inactive:=public.get_my_pt_wage('670eb72b-5f5c-43fc-83ff-f9d5f6a7c026');
 IF inactive->>'error' IS DISTINCT FROM 'dealer not found or inactive' OR inactive ? 'employment_type' THEN
  RAISE EXCEPTION 'inactive_dealer_payload_not_explicit_error:%',inactive; END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='065801a0-565e-4bd6-9c2d-ee252b7e6494';
SET LOCAL request.jwt.claims='{"sub":"065801a0-565e-4bd6-9c2d-ee252b7e6494","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN PERFORM public.get_my_pt_wage('670eb72b-5f5c-43fc-83ff-f9d5f6a7c026');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider_read_pt_salary'; END IF;
 denied:=false;
 BEGIN PERFORM public.get_my_dealer_payroll('670eb72b-5f5c-43fc-83ff-f9d5f6a7c026',2026,10);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider_read_saved_salary'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.dealers WHERE id='670eb72b-5f5c-43fc-83ff-f9d5f6a7c026' AND user_id IS NULL AND status='active')
  OR NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE id='42c28d65-5550-497a-9659-a7845bfab498' AND status='draft') THEN
  RAISE EXCEPTION 'self_salary_read_failed_to_restore_fixture'; END IF;
END $$;
SELECT 'DEALER_SELF_SALARY_NATIVE_OWNER_OUTSIDER_DRAFT_ROLLBACK_PASS';
