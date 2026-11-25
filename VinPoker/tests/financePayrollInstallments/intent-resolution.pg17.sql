\set ON_ERROR_STOP on
\ir installments.seed.sql
DO $$ BEGIN
  IF to_regprocedure('public.resolve_pt_full_payment_intent_v1(uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PT_FULL_INTENT_RESOLUTION_MISSING: retained requests must not block future periods or impersonate installment receipts';
  END IF;
  BEGIN
    PERFORM public.resolve_pt_full_payment_intent_v1(current_setting('test.pt_statement_id')::uuid,
      current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000194');
    RAISE EXCEPTION 'unadopted_intent_discarded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
SELECT public.approve_pt_statement_installments_v1(current_setting('test.pt_statement_id')::uuid,
 current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000092','TEST approved plan');
SELECT public.record_pt_statement_installment_v1(current_setting('test.pt_statement_id')::uuid,
 current_setting('test.pt_statement_hash'),2000000,'cash',NULL,
 '18000000-0000-4000-8000-000000000093','TEST partial payment');
RESET ROLE;
CREATE TEMP TABLE resolution_facts_before AS SELECT jsonb_build_object(
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
 'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
 'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.payroll_audit_log a)
) AS facts;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
  r:=public.resolve_pt_full_payment_intent_v1(current_setting('test.pt_statement_id')::uuid,
    current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000194');
  IF r->>'resolution' IS DISTINCT FROM 'superseded_by_installments'
    OR r->>'actor_id' IS DISTINCT FROM '18000000-0000-4000-8000-000000000011'
    OR r->>'statement_id' IS DISTINCT FROM current_setting('test.pt_statement_id')
    OR r->>'statement_hash' IS DISTINCT FROM current_setting('test.pt_statement_hash')
    OR r->>'club_id' IS DISTINCT FROM '18000000-0000-4000-8000-000000000001'
    OR r->>'dealer_id' IS DISTINCT FROM '18000000-0000-4000-8000-000000000051'
    OR r->>'intent_key' IS DISTINCT FROM '18000000-0000-4000-8000-000000000194'
    OR r->>'approved_amount_vnd' IS DISTINCT FROM '5000000'
    OR r->>'legacy_payment_recorded' IS DISTINCT FROM 'false' OR r ? 'payment_id'
  THEN RAISE EXCEPTION 'intent_resolution_not_bound_to_original_request'; END IF;
  BEGIN
    PERFORM public.resolve_pt_full_payment_intent_v1(current_setting('test.pt_statement_id')::uuid,
      repeat('b',64),'18000000-0000-4000-8000-000000000194');
    RAISE EXCEPTION 'changed_statement_resolved';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.resolve_pt_full_payment_intent_v1(current_setting('test.pt_statement_id')::uuid,
      current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000093');
    RAISE EXCEPTION 'actual_payment_request_discarded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO auth.users(id) VALUES ('18000000-0000-4000-8000-000000000012');
INSERT INTO public.club_cashiers(club_id,user_id) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000012';
SELECT public.resolve_pt_full_payment_intent_v1(current_setting('test.pt_statement_id')::uuid,
 current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000194');
RESET ROLE;
DELETE FROM public.club_cashiers WHERE user_id='18000000-0000-4000-8000-000000000012';
INSERT INTO public.club_accountants(club_id,user_id) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.resolve_pt_full_payment_intent_v1(current_setting('test.pt_statement_id')::uuid,
      current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000194');
    RAISE EXCEPTION 'revoked_cashier_or_readonly_accountant_resolved_intent';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT facts FROM resolution_facts_before) IS DISTINCT FROM jsonb_build_object(
   'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
   'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
   'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
   'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.payroll_audit_log a))
  THEN RAISE EXCEPTION 'intent_resolution_changed_financial_facts'; END IF;
END $$;
ROLLBACK;
SELECT 'PT_OLD_INTENT_SCOPED_RESOLUTION_NO_FINANCIAL_MUTATION_PASS';
