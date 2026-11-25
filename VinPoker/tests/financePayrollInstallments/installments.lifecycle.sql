\ir installments.seed.sql
SELECT public.approve_pt_statement_installments_v1(current_setting('test.pt_statement_id')::uuid,
 current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000092','TEST owner approves unpaid plan');
RESET ROLE;
INSERT INTO auth.users(id) VALUES ('18000000-0000-4000-8000-000000000012');
INSERT INTO public.club_cashiers(club_id,user_id) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000012';
DO $$ BEGIN
  BEGIN
    PERFORM public.void_dealer_payroll_statement(current_setting('test.pt_statement_id')::uuid,'TEST cashier cannot cancel owner-approved installment plan');
    RAISE EXCEPTION 'cashier_cancelled_owner_approved_installment_plan';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000011';
SELECT public.void_dealer_payroll_statement(current_setting('test.pt_statement_id')::uuid,'TEST owner cancels untouched plan');
DO $$ DECLARE d jsonb; BEGIN
  d:=public.get_pt_statement_installments_v1(current_setting('test.pt_statement_id')::uuid);
  IF d->>'remaining_vnd' IS DISTINCT FROM '0' OR d->>'state' IS DISTINCT FROM 'voided'
    OR d->>'approved_amount_vnd' IS DISTINCT FROM '5000000' OR d->>'paid_total_vnd' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'cancelled_unpaid_plan_still_reported_as_debt'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.dealer_pt_wage_payments) THEN RAISE EXCEPTION 'cancelled_plan_created_cash'; END IF;
END $$;
ROLLBACK;
SELECT 'PT_UNPAID_ADOPTED_PLAN_OWNER_ONLY_VOID_ZERO_DEBT_PASS' AS result;
