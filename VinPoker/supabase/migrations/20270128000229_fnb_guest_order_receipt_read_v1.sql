-- CLI-created20261021041844, reserved forward229; LOCAL candidate, NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF to_regclass('floor_private.fnb_guest_request_receipts_v1') IS NULL
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)')) IS DISTINCT FROM '7d88cb039763da1b2135e79d80368529'
 THEN RAISE EXCEPTION 'fnb229_requires_reviewed228';END IF;
END $$;
CREATE FUNCTION public.fnb_guest_order_receipt_v1(p_token text,p_seat smallint,p_customer_name text,
 p_note text,p_lines jsonb,p_payment_method text,p_client_request_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tok public.fnb_table_qr_tokens;saved floor_private.fnb_guest_request_receipts_v1;intent jsonb;request_key text:=nullif(btrim(p_client_request_id),'');
BEGIN
 SELECT * INTO tok FROM public.fnb_table_qr_tokens WHERE token=p_token AND is_active;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOKEN_INVALID');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fnb_settings WHERE club_id=tok.club_id AND guest_order_enabled)
 THEN RETURN jsonb_build_object('error','GUEST_ORDER_DISABLED');END IF;
 IF request_key IS NULL OR length(request_key)>200 THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 intent:=jsonb_build_object('seat',p_seat,'customer_name',left(nullif(btrim(p_customer_name),''),60),
  'note',left(nullif(btrim(p_note),''),200),'lines',p_lines,'payment_method',p_payment_method);
 SELECT * INTO saved FROM floor_private.fnb_guest_request_receipts_v1 WHERE token_id=tok.id AND request_id=request_key;
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false,'request_id',request_key,'payload',intent,'receipt',NULL);END IF;
 IF saved.payload IS DISTINCT FROM intent THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
 RETURN jsonb_build_object('found',true,'request_id',request_key,'payload',intent,
  'receipt',saved.result||jsonb_build_object('idempotent',true));
END $$;
REVOKE ALL ON FUNCTION public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text) TO anon,authenticated;
COMMIT;
