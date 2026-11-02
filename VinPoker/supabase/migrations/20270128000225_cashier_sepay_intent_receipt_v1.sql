-- CLI candidate20261021021619; reserved225 after source/native catalog checks.
-- New wrapper only: existing money/seat/ignore policy stays in the old writers.
-- Recovery: revert the consumer, revoke this exact new signature in a forward
-- migration; preserve all receipt and payment history. No archive replay/backfill.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='cashier_sepay_intent_v1') THEN
  RAISE EXCEPTION 'sepay225_function_collision';
 END IF;
 IF pg_catalog.to_regprocedure('public.manual_confirm_bank_transaction(uuid,uuid,text)') IS NULL
  OR pg_catalog.to_regprocedure('public.ignore_bank_transaction(uuid,text)') IS NULL
  OR pg_catalog.to_regclass('public.ops_cashier_mutation_idempotency') IS NULL THEN
  RAISE EXCEPTION 'sepay225_dependency_missing';
 END IF;
 IF pg_catalog.has_table_privilege('authenticated','public.ops_cashier_mutation_idempotency','SELECT,INSERT,UPDATE,DELETE')
  OR pg_catalog.has_table_privilege('anon','public.ops_cashier_mutation_idempotency','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'sepay225_receipt_acl_drift';
 END IF;
END $$;
CREATE FUNCTION public.cashier_sepay_intent_v1(
 p_mode text,p_operation text,p_bank_transaction_id uuid,p_registration_id uuid,p_reason text,p_request_id uuid,
 p_expected_snapshot jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_bank public.bank_transactions%ROWTYPE;
 v_club uuid; v_count integer; v_super boolean;
 v_payload jsonb; v_key text; v_hash text; v_result jsonb;
 v_prior public.ops_cashier_mutation_idempotency%ROWTYPE;
 v_replayed boolean:=false;
 v_total bigint;
 v_field text; v_number text;
BEGIN
 IF v_actor IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','unauthorized'); END IF;
 IF p_mode IS NULL OR p_mode NOT IN('commit','receipt') OR p_operation IS NULL OR p_operation NOT IN('confirm','ignore')
  OR p_bank_transaction_id IS NULL OR p_request_id IS NULL
  OR (p_operation='confirm' AND p_registration_id IS NULL) OR (p_operation='ignore' AND p_registration_id IS NOT NULL)
  OR pg_catalog.length(COALESCE(p_reason,''))>2000 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_sepay_intent');
 END IF;
 IF p_expected_snapshot IS NOT NULL THEN
  IF pg_catalog.jsonb_typeof(p_expected_snapshot)<>'object' THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_sepay_snapshot'); END IF;
  IF NOT(p_expected_snapshot ?& ARRAY['bank_amount','total_pay'])
   OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_expected_snapshot))<>2 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_sepay_snapshot'); END IF;
  FOREACH v_field IN ARRAY ARRAY['bank_amount','total_pay'] LOOP
   IF pg_catalog.jsonb_typeof(p_expected_snapshot->v_field)='null' THEN CONTINUE; END IF;
   IF pg_catalog.jsonb_typeof(p_expected_snapshot->v_field)<>'number' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_sepay_snapshot'); END IF;
   v_number:=p_expected_snapshot->>v_field;
   IF v_number !~ '^-?[0-9]+$' OR pg_catalog.length(v_number)>17 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_sepay_snapshot'); END IF;
   IF pg_catalog.abs(v_number::numeric)>9007199254740991 OR (v_field='total_pay' AND v_number::numeric<0) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_sepay_snapshot'); END IF;
  END LOOP;
 END IF;
 v_key:='sepay:v1:'||v_actor::text||':'||p_request_id::text;
 -- Lock before reading authority: a waiter must observe revocation at lock release.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key,0));
 SELECT * INTO v_bank FROM public.bank_transactions WHERE id=p_bank_transaction_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','bank_txn_not_found'); END IF;
 -- Recheck current authority even for replay/read: no stale role gets an old receipt.
 IF p_operation='confirm' THEN
  SELECT t.club_id INTO v_club FROM public.tournament_registrations r
   JOIN public.tournaments t ON t.id=r.tournament_id WHERE r.id=p_registration_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','registration_not_found'); END IF;
  IF v_club IS NULL OR COALESCE(public.is_club_cashier(v_actor,v_club),false) IS NOT TRUE THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
 ELSE
  v_club:=v_bank.club_id;
  IF v_club IS NULL THEN
   SELECT count(DISTINCT a.club_id) INTO v_count FROM public.platform_bank_accounts a
    WHERE a.account_number=v_bank.account_number AND a.is_active AND a.club_id IS NOT NULL;
   IF v_count=1 THEN SELECT a.club_id INTO v_club FROM public.platform_bank_accounts a
    WHERE a.account_number=v_bank.account_number AND a.is_active AND a.club_id IS NOT NULL LIMIT 1; END IF;
  END IF;
  v_super:=COALESCE(public.has_role(v_actor,'super_admin'::public.app_role),false);
  IF (v_club IS NULL AND NOT v_super) OR (v_club IS NOT NULL
   AND NOT (COALESCE(public.is_club_cashier(v_actor,v_club),false) OR v_super)) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
 END IF;
 v_payload:=pg_catalog.jsonb_build_object('operation',p_operation,'bank_transaction_id',p_bank_transaction_id,
  'registration_id',p_registration_id,'reason',NULLIF(pg_catalog.btrim(p_reason),''));
 IF p_expected_snapshot IS NOT NULL THEN v_payload:=v_payload||pg_catalog.jsonb_build_object('snapshot',p_expected_snapshot); END IF;
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_payload::text,'UTF8')),'hex');
 -- Both modes use one lock. A receipt read cannot overtake an in-flight commit
 -- using the same actor/key. An absent receipt never authorizes a new key.
 SELECT * INTO v_prior FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key=v_key FOR UPDATE;
 IF FOUND THEN
  IF v_prior.actor_user_id<>v_actor OR v_prior.operation<>'sepay_'||p_operation OR v_prior.request_hash<>v_hash THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','request_payload_conflict');
  END IF;
  IF v_prior.response IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','sepay_receipt_incomplete'); END IF;
  v_result:=v_prior.response;v_replayed:=true;
 ELSIF p_mode='commit' THEN
  IF p_expected_snapshot IS NOT NULL THEN
   SELECT * INTO v_bank FROM public.bank_transactions WHERE id=p_bank_transaction_id FOR UPDATE;
   IF p_operation='confirm' THEN SELECT total_pay INTO v_total FROM public.tournament_registrations WHERE id=p_registration_id FOR UPDATE; END IF;
   IF v_bank.amount IS DISTINCT FROM (p_expected_snapshot->>'bank_amount')::bigint
    OR v_total IS DISTINCT FROM (p_expected_snapshot->>'total_pay')::bigint THEN
    v_result:=pg_catalog.jsonb_build_object('ok',false,'error','sepay_snapshot_changed');
   END IF;
  END IF;
  IF v_result IS NOT NULL THEN NULL;
  ELSIF p_operation='confirm' THEN
   v_result:=public.manual_confirm_bank_transaction(p_bank_transaction_id,p_registration_id,NULLIF(pg_catalog.btrim(p_reason),''));
  ELSE
   v_result:=public.ignore_bank_transaction(p_bank_transaction_id,NULLIF(pg_catalog.btrim(p_reason),''));
  END IF;
  IF v_result IS NULL OR pg_catalog.jsonb_typeof(v_result)<>'object'
   OR pg_catalog.jsonb_typeof(v_result->'ok') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'sepay225_writer_response_unverified';
  END IF;
  INSERT INTO public.ops_cashier_mutation_idempotency(idempotency_key,actor_user_id,operation,request_hash,response)
   VALUES(v_key,v_actor,'sepay_'||p_operation,v_hash,v_result);
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'status',CASE WHEN v_result IS NULL THEN 'receipt_not_found' ELSE 'receipt_found' END,
  'actor_id',v_actor,'request_id',p_request_id,'club_id',v_club,'payload',v_payload,'request_hash',v_hash,
  'receipt',v_result,'replayed',v_replayed);
END $$;
REVOKE ALL ON FUNCTION public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb) TO authenticated;
COMMIT;
