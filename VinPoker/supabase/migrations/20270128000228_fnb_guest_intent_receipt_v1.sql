-- CLI-created20261021041018; reserved local forward228, NOT LIVE.
-- Recovery: restore backed original function definition/ACL; retain receipt rows.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $guard$
DECLARE definition text;body text;
BEGIN
 SELECT pg_get_functiondef(oid),prosrc INTO definition,body FROM pg_proc
 WHERE oid=to_regprocedure('public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)');
 IF body IS NULL OR md5(body)<>'3b18941a8cee95dc16bedc8c8c603a77' THEN RAISE EXCEPTION 'fnb228_definition_drift';END IF;
 IF to_regprocedure('floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text)') IS NOT NULL
 OR to_regclass('floor_private.fnb_guest_request_receipts_v1') IS NOT NULL
 OR to_regclass('floor_private.fnb_guest_release_backup228') IS NOT NULL THEN RAISE EXCEPTION 'fnb228_catalog_collision';END IF;
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.fnb_guest_create_order(',
  'CREATE FUNCTION floor_private.fnb_guest_create_order_core228(');
 EXECUTE definition;
END $guard$;
CREATE TABLE floor_private.fnb_guest_release_backup228 AS
 SELECT pg_get_functiondef(oid) AS definition,proacl AS acl,pg_get_userbyid(proowner) AS owner_name
 FROM pg_proc WHERE oid='public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)'::regprocedure;
ALTER TABLE floor_private.fnb_guest_release_backup228 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_guest_release_backup228 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text) SECURITY INVOKER;
ALTER FUNCTION floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text) SET search_path='';
REVOKE ALL ON FUNCTION floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE floor_private.fnb_guest_request_receipts_v1(
 token_id uuid NOT NULL REFERENCES public.fnb_table_qr_tokens(id),
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 1 AND 200),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 order_id uuid NOT NULL REFERENCES public.fnb_orders(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(token_id,request_id)
);
ALTER TABLE floor_private.fnb_guest_request_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_guest_request_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.fnb_guest_create_order(p_token text,p_seat smallint DEFAULT NULL,
 p_customer_name text DEFAULT NULL,p_note text DEFAULT NULL,p_lines jsonb DEFAULT '[]',
 p_payment_method text DEFAULT 'cash',p_client_request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE tok public.fnb_table_qr_tokens; saved floor_private.fnb_guest_request_receipts_v1;
 request_key text:=coalesce(nullif(btrim(p_client_request_id),''),gen_random_uuid()::text);
 intent jsonb;outcome jsonb;
BEGIN
 SELECT * INTO tok FROM public.fnb_table_qr_tokens WHERE token=p_token AND is_active FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOKEN_INVALID');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fnb_settings WHERE club_id=tok.club_id AND guest_order_enabled)
 THEN RETURN jsonb_build_object('error','GUEST_ORDER_DISABLED');END IF;
 IF length(request_key)>200 THEN RETURN jsonb_build_object('error','INVALID_INPUT');END IF;
 intent:=jsonb_build_object('seat',p_seat,'customer_name',left(nullif(btrim(p_customer_name),''),60),
  'note',left(nullif(btrim(p_note),''),200),'lines',p_lines,'payment_method',p_payment_method);
 SELECT * INTO saved FROM floor_private.fnb_guest_request_receipts_v1 WHERE token_id=tok.id AND request_id=request_key;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM intent THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
  RETURN saved.result||jsonb_build_object('idempotent',true);
 END IF;
 -- No immutable request exists for legacy orders: do not infer old intent from
 -- current menu, mutable order lines or current bank configuration.
 IF EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=tok.club_id AND client_request_id=request_key)
 THEN RETURN jsonb_build_object('error','REQUEST_ID_CONFLICT');END IF;
 outcome:=floor_private.fnb_guest_create_order_core228(p_token,p_seat,p_customer_name,p_note,p_lines,p_payment_method,request_key);
 IF outcome->>'status'='ok' AND outcome->>'order_id' IS NOT NULL THEN
  INSERT INTO floor_private.fnb_guest_request_receipts_v1(token_id,request_id,payload,result,order_id)
   VALUES(tok.id,request_key,intent,outcome,(outcome->>'order_id')::uuid);
 END IF;
 RETURN outcome;
END $function$;
-- CREATE OR REPLACE preserves reviewed public RPC ACL; private objects above
-- have no browser/service grants. No historical migration/ledger is edited.
COMMIT;
