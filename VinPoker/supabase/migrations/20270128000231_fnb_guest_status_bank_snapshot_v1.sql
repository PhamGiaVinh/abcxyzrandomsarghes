-- CLI-created20261021051830; reserved231 after source/ledger collision check.
-- LOCAL CANDIDATE. Only bank instructions change; TTL/sweeper policy unchanged.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fnb_guest_order_status(text,uuid)')) IS DISTINCT FROM '40bcb1f1fff465964785b74779f04d58'
 OR to_regclass('floor_private.fnb_guest_status_release_backup231') IS NOT NULL
 OR to_regclass('floor_private.fnb_guest_request_receipts_v1') IS NULL
 THEN RAISE EXCEPTION 'fnb231_definition_drift_or_collision';END IF;
END $$;
CREATE TABLE floor_private.fnb_guest_status_release_backup231 AS
 SELECT pg_get_functiondef(oid) definition,proacl acl,pg_get_userbyid(proowner) owner_name
 FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure;
ALTER TABLE floor_private.fnb_guest_status_release_backup231 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_guest_status_release_backup231 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fnb_guest_order_status(p_token text,p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tok public.fnb_table_qr_tokens;ord public.fnb_orders;proof jsonb;proof_count bigint;
 bank jsonb:=NULL;bank_source text:='not_applicable';ttl_bank integer;ttl_cash integer;ttl integer;
BEGIN
 -- Preserve existing invoice access via revoked QR; never allow another token's order.
 SELECT * INTO tok FROM public.fnb_table_qr_tokens WHERE token=p_token;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOKEN_INVALID');END IF;
 SELECT * INTO ord FROM public.fnb_orders WHERE id=p_order_id AND qr_token_id=tok.id;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','ORDER_NOT_FOUND');END IF;
 SELECT coalesce(s.guest_bank_ttl_secs,1800),coalesce(s.pending_ttl_secs,900)
 INTO ttl_bank,ttl_cash FROM public.fnb_settings s WHERE s.club_id=ord.club_id;
 ttl:=CASE WHEN ord.payment_method='bank_transfer' THEN coalesce(ttl_bank,1800) ELSE coalesce(ttl_cash,900) END;
 IF ord.payment_method='bank_transfer' AND ord.status='pending' THEN
  bank_source:='unverified';
  SELECT count(*) INTO proof_count FROM floor_private.fnb_guest_request_receipts_v1
   WHERE token_id=tok.id AND order_id=ord.id;
  IF proof_count=1 THEN
   SELECT result INTO proof FROM floor_private.fnb_guest_request_receipts_v1 WHERE token_id=tok.id AND order_id=ord.id;
   IF proof->>'status'='ok' AND proof->>'order_id'=ord.id::text AND proof->>'payment_method'='bank_transfer'
    AND proof->'subtotal_vnd'=to_jsonb(ord.subtotal_vnd) AND proof->>'reference_code'=ord.reference_code
    AND jsonb_typeof(proof->'bank')='object'
    AND jsonb_typeof(proof #> '{bank,account_number}')='string' AND nullif(btrim(proof #>> '{bank,account_number}'),'') IS NOT NULL
    AND jsonb_typeof(proof #> '{bank,bank_name}') IN('string','null')
    AND jsonb_typeof(proof #> '{bank,bank_bin}') IN('string','null')
    AND jsonb_typeof(proof #> '{bank,account_holder}') IN('string','null')
    AND jsonb_typeof(proof #> '{bank,qr_code_url}') IN('string','null')
   THEN bank:=proof->'bank';bank_source:='snapshot';END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('status','ok','order',jsonb_build_object(
  'id',ord.id,'order_status',ord.status,'subtotal_vnd',ord.subtotal_vnd,'payment_method',ord.payment_method,
  'reference_code',ord.reference_code,'guest_seat',ord.guest_seat,'created_at',ord.created_at,'paid_at',ord.paid_at,
  'expires_at',ord.created_at+(ttl*interval '1 second')),'bank',bank,'bank_source',bank_source);
END $$;
-- CREATE OR REPLACE retains reviewed anon/authenticated/service_role ACL.
COMMIT;
