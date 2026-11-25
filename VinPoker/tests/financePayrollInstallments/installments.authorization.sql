\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'vinpoker_ops_pt_installment' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
END $$;
CREATE TEMP TABLE before_auth_tests AS SELECT jsonb_build_object(
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
  'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
  'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
  'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY statement_id) FROM public.finance_pt_installment_plans_v1 p)
) AS fingerprint;
SELECT set_config('test.pt_statement_id',statement_id::text,true),set_config('test.pt_statement_hash',statement_hash,true)
FROM public.finance_pt_installment_plans_v1;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000012';
DO $$ DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; h text:=current_setting('test.pt_statement_hash'); r jsonb; BEGIN
  r:=public.get_pt_statement_installments_v1(s);
  IF r->>'paid_total_vnd' IS DISTINCT FROM '5000000' OR jsonb_array_length(r->'payments')<>2 THEN
    RAISE EXCEPTION 'authorized_cashier_cannot_read_actual_payments'; END IF;
  BEGIN
    PERFORM public.approve_pt_statement_installments_v1(s,h,'18000000-0000-4000-8000-000000000092','TEST owner approves 5M budget');
    RAISE EXCEPTION 'cashier_self_approved_plan';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(s,h,2000000,'bank','TEST first 2M',
      '18000000-0000-4000-8000-000000000093','TEST starting partial debt');
    RAISE EXCEPTION 'different_actor_reused_original_receipt';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
-- A same-session cashier loses access as soon as its exact club membership is removed.
DELETE FROM public.club_cashiers WHERE user_id='18000000-0000-4000-8000-000000000012';
INSERT INTO auth.users(id) VALUES ('18000000-0000-4000-8000-000000000013');
INSERT INTO public.profiles(user_id,display_name) VALUES ('18000000-0000-4000-8000-000000000013','Second TEST club owner');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000013','PT second TEST club','TEST','approved');
INSERT INTO public.club_cashiers(club_id,user_id) VALUES
 ('18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000012');
SET LOCAL ROLE authenticated;
DO $$ DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; h text:=current_setting('test.pt_statement_hash'); BEGIN
  BEGIN
    PERFORM public.get_pt_statement_installments_v1(s);
    RAISE EXCEPTION 'revoked_actor_kept_cross_club_read';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(s,h,1,'cash',NULL,'18000000-0000-4000-8000-000000000099','TEST forbidden');
    RAISE EXCEPTION 'revoked_actor_kept_cross_club_payment';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO public.club_accountants(club_id,user_id) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(current_setting('test.pt_statement_id')::uuid,
      current_setting('test.pt_statement_hash'),1,'cash',NULL,'18000000-0000-4000-8000-000000000099','TEST accountant cannot pay');
    RAISE EXCEPTION 'accountant_membership_granted_payment';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.get_pt_statement_installments_v1(current_setting('test.pt_statement_id')::uuid);
    RAISE EXCEPTION 'anonymous_detail_allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(current_setting('test.pt_statement_id')::uuid,
      current_setting('test.pt_statement_hash'),1,'cash',NULL,'18000000-0000-4000-8000-000000000099','TEST anonymous');
    RAISE EXCEPTION 'anonymous_payment_allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE after_auth jsonb; BEGIN
  SELECT jsonb_build_object(
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
    'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
    'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
    'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY statement_id) FROM public.finance_pt_installment_plans_v1 p)
  ) INTO after_auth;
  IF after_auth IS DISTINCT FROM (SELECT fingerprint FROM before_auth_tests) THEN
    RAISE EXCEPTION 'denied_requests_changed_financial_rows'; END IF;
END $$;
ROLLBACK;
SELECT 'PT_CASHIER_SCOPE_REVOCATION_ACCOUNTANT_ANON_NO_FINANCIAL_MUTATION_PASS' AS result;
