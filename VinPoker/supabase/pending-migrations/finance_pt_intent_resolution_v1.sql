-- PENDING ONLY. Requires the separately reviewed finance_pt_installments_v1 extension.
-- Reads/locks existing facts only; no cash, statement, plan, or audit row is changed.
-- ROLLBACK: drop this new function; retain original requests and canonical receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF to_regprocedure('public._lock_pt_installment_statement_v1(uuid)') IS NULL
    OR to_regclass('public.finance_pt_installment_plans_v1') IS NULL THEN
    RAISE EXCEPTION 'PT_INTENT_RESOLUTION_FOUNDATION_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid='public._lock_pt_installment_statement_v1(uuid)'::regprocedure
      AND md5(p.prosrc)='cb54d8d89c5bad3508aa9e3cc0cc324b'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=""']
      AND p.proacl='{postgres=X/postgres}'::aclitem[])
    OR NOT EXISTS(SELECT FROM pg_catalog.pg_proc p
    WHERE p.oid='public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure
      AND md5(p.prosrc)='0389c954b5a5fdaa7b1d9cbf38a30c06'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public']
      AND p.proacl='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[])
  THEN RAISE EXCEPTION 'PT_INTENT_RESOLUTION_FOUNDATION_DRIFT'; END IF;
END $$;
CREATE FUNCTION public.resolve_pt_full_payment_intent_v1(
  p_statement_id uuid,p_expected_hash text,p_intent_key text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $$ DECLARE s public.dealer_payroll_statements%rowtype;
  a public.finance_pt_installment_plans_v1%rowtype; actor uuid;
BEGIN
  -- Same lock order and actor recheck as approval/payment; a lost write cannot
  -- commit behind this proof because adoption permanently fences legacy full pay.
  s:=public._lock_pt_installment_statement_v1(p_statement_id);
  actor:=public._assert_dealer_payroll_statement_actor(s.club_id);
  IF p_expected_hash IS DISTINCT FROM s.statement_hash OR p_intent_key IS NULL
    OR p_intent_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'PT_INTENT_RESOLUTION_CONTEXT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.finance_pt_installment_plans_v1 WHERE statement_id=s.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PT_INTENT_RESOLUTION_ADOPTION_REQUIRED' USING ERRCODE='55000'; END IF;
  IF ROW(a.club_id,a.dealer_id,a.statement_hash,a.approved_amount_vnd)
    IS DISTINCT FROM ROW(s.club_id,s.dealer_id,s.statement_hash,s.net_amount_vnd) THEN
    RAISE EXCEPTION 'PT_INTENT_RESOLUTION_APPROVAL_BINDING_INVALID' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT FROM public.dealer_pt_wage_payments WHERE dealer_id=s.dealer_id AND idempotency_key=p_intent_key) THEN
    RAISE EXCEPTION 'PT_INTENT_RESOLUTION_RECORDED_REQUEST_REQUIRES_REVIEW' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('resolution','superseded_by_installments','actor_id',actor,
    'statement_id',s.id,'statement_hash',s.statement_hash,'club_id',s.club_id,'dealer_id',s.dealer_id,
    'intent_key',p_intent_key,'approved_amount_vnd',s.net_amount_vnd,
    'legacy_payment_recorded',false,'approval_request_id',a.request_id);
END $$;
REVOKE ALL ON FUNCTION public.resolve_pt_full_payment_intent_v1(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pt_full_payment_intent_v1(uuid,text,text) TO authenticated;
COMMIT;
