-- CLI-created20261021045502, reserved230 after source/ledger collision check.
-- LOCAL CANDIDATE ONLY. Never cancel an existing order or delete its receipt.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)')) IS DISTINCT FROM '7d88cb039763da1b2135e79d80368529'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)')) IS DISTINCT FROM '6ad2faf30241557404a88af898b1e8b7'
 OR to_regprocedure('public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'fnb230_contract_drift_or_collision';END IF;
END $$;
-- A terminal request without an order is allowed ONLY with the explicit fence.
-- IS TRUE prevents SQL CHECK's NULL acceptance from masking malformed receipts.
ALTER TABLE floor_private.fnb_guest_request_receipts_v1 ADD CONSTRAINT fnb_guest_receipt_terminal230 CHECK((
 (order_id IS NOT NULL AND result->>'status'='ok' AND result->>'order_id'=order_id::text)
 OR (order_id IS NULL AND result->>'error'='REQUEST_ABANDONED' AND result->>'request_id'=request_id)
) IS TRUE);
ALTER TABLE floor_private.fnb_guest_request_receipts_v1 ALTER COLUMN order_id DROP NOT NULL;
CREATE INDEX fnb_guest_abandoned_rate230 ON floor_private.fnb_guest_request_receipts_v1(token_id,created_at) WHERE order_id IS NULL;
CREATE FUNCTION public.fnb_guest_abandon_request_v1(p_token text,p_seat smallint,p_customer_name text,
 p_note text,p_lines jsonb,p_payment_method text,p_client_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tok public.fnb_table_qr_tokens;saved floor_private.fnb_guest_request_receipts_v1;
 request_key text:=nullif(btrim(p_client_request_id),'');intent jsonb;outcome jsonb;
BEGIN
 -- Same first lock as create228: a delayed create must observe either the
 -- previously committed order or the durable abandoned-request fence.
 SELECT * INTO tok FROM public.fnb_table_qr_tokens WHERE token=p_token AND is_active FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOKEN_INVALID');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fnb_settings WHERE club_id=tok.club_id AND guest_order_enabled)
 THEN RETURN jsonb_build_object('error','GUEST_ORDER_DISABLED');END IF;
 IF request_key IS NULL OR length(request_key)>200 THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 intent:=jsonb_build_object('seat',p_seat,'customer_name',left(nullif(btrim(p_customer_name),''),60),
  'note',left(nullif(btrim(p_note),''),200),'lines',p_lines,'payment_method',p_payment_method);
 SELECT * INTO saved FROM floor_private.fnb_guest_request_receipts_v1 WHERE token_id=tok.id AND request_id=request_key;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM intent THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
  outcome:=saved.result;
 ELSE
  IF EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=tok.club_id AND client_request_id=request_key)
  THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
  -- Bound anonymous metadata writes using the existing token rate budget
  -- (10 per 10 minutes). Existing receipt replay remains exempt.
  IF (SELECT count(*) FROM floor_private.fnb_guest_request_receipts_v1
      WHERE token_id=tok.id AND order_id IS NULL AND created_at>now()-interval '10 minutes')>=10
  THEN RETURN jsonb_build_object('error','RATE_LIMITED');END IF;
  outcome:=jsonb_build_object('error','REQUEST_ABANDONED','request_id',request_key);
  -- This fence is durable history; never expire/delete it to "unlock" a key.
  INSERT INTO floor_private.fnb_guest_request_receipts_v1(token_id,request_id,payload,result,order_id)
   VALUES(tok.id,request_key,intent,outcome,NULL);
 END IF;
 RETURN jsonb_build_object('found',true,'request_id',request_key,'payload',intent,
  'receipt',outcome||jsonb_build_object('idempotent',true));
END $$;
REVOKE ALL ON FUNCTION public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text) TO anon,authenticated;
COMMIT;
