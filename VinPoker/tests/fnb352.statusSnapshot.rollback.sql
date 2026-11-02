\set ON_ERROR_STOP on
-- Run after candidate231 inside its transaction; caller rolls everything back.
CREATE TEMP TABLE fnb352_target AS
 SELECT x.order_id,x.request_id,t.id token_id,t.token,x.result->'bank' bank
 FROM floor_private.fnb_guest_request_receipts_v1 x JOIN public.fnb_table_qr_tokens t ON t.id=x.token_id
 WHERE x.payload->>'customer_name'='TEST350';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_port()<>55441
 OR (SELECT count(*) FROM fnb352_target)<>1 THEN RAISE EXCEPTION 'exact352_fixture_required';END IF;
 IF (SELECT proacl FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure)
 IS DISTINCT FROM (SELECT acl FROM floor_private.fnb_guest_status_release_backup231)
 OR has_table_privilege('anon','floor_private.fnb_guest_status_release_backup231','SELECT')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure AND prosecdef AND proconfig @>ARRAY['search_path=""'])
 THEN RAISE EXCEPTION 'status352_acl_path';END IF;
END $$;
CREATE FUNCTION pg_temp.fnb352_expect(token text,order_id uuid,source text,bank jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb;BEGIN
 PERFORM set_config('role','anon',true);
 r:=public.fnb_guest_order_status(token,order_id);
 PERFORM set_config('role','none',true);
 IF r->>'status' IS DISTINCT FROM 'ok' OR r->>'bank_source' IS DISTINCT FROM source
 OR r->'bank' IS DISTINCT FROM coalesce(bank,'null'::jsonb) THEN RAISE EXCEPTION 'status352_wrong_source:%',source;END IF;
END $$;
SELECT pg_temp.fnb352_expect(token,order_id,'snapshot',bank) FROM fnb352_target;
SAVEPOINT legacy352;
UPDATE floor_private.fnb_guest_request_receipts_v1 SET token_id=(
 SELECT t.id FROM public.fnb_table_qr_tokens t JOIN floor_private.fnb335_fixture f ON t.token=f.fixture->'tokens'->>1)
 WHERE request_id=(SELECT request_id FROM fnb352_target);
SELECT pg_temp.fnb352_expect(token,order_id,'unverified',NULL) FROM fnb352_target;
ROLLBACK TO legacy352;
SAVEPOINT malformed352;
UPDATE floor_private.fnb_guest_request_receipts_v1 SET result=jsonb_set(result,'{bank,account_number}','null')
 WHERE request_id=(SELECT request_id FROM fnb352_target);
SELECT pg_temp.fnb352_expect(token,order_id,'unverified',NULL) FROM fnb352_target;
ROLLBACK TO malformed352;
SAVEPOINT duplicate352;
INSERT INTO floor_private.fnb_guest_request_receipts_v1(token_id,request_id,payload,result,order_id)
 SELECT token_id,gen_random_uuid()::text,payload,result,order_id FROM floor_private.fnb_guest_request_receipts_v1
 WHERE request_id=(SELECT request_id FROM fnb352_target);
SELECT pg_temp.fnb352_expect(token,order_id,'unverified',NULL) FROM fnb352_target;
ROLLBACK TO duplicate352;
SAVEPOINT mismatch352;
UPDATE public.fnb_orders SET reference_code='LOCAL352-MISMATCH' WHERE id=(SELECT order_id FROM fnb352_target);
SELECT pg_temp.fnb352_expect(token,order_id,'unverified',NULL) FROM fnb352_target;
ROLLBACK TO mismatch352;
SAVEPOINT revoked352;
UPDATE public.fnb_table_qr_tokens SET is_active=false WHERE id=(SELECT token_id FROM fnb352_target);
SELECT pg_temp.fnb352_expect(token,order_id,'snapshot',bank) FROM fnb352_target;
ROLLBACK TO revoked352;
DO $$ DECLARE token_b text;target uuid;r jsonb;cash_id uuid;token_a text;BEGIN
 SELECT f.fixture->'tokens'->>1 INTO token_b FROM floor_private.fnb335_fixture f;
 SELECT order_id,token INTO target,token_a FROM fnb352_target;
 SELECT x.order_id INTO cash_id FROM floor_private.fnb_guest_request_receipts_v1 x
 JOIN floor_private.fnb335_fixture f ON x.request_id=f.fixture->'keys'->>0;
 PERFORM set_config('role','anon',true);
 r:=public.fnb_guest_order_status(token_b,target);
 IF r->>'error' IS DISTINCT FROM 'ORDER_NOT_FOUND' THEN RAISE EXCEPTION 'status352_cross_token';END IF;
 r:=public.fnb_guest_order_status('LOCAL-INVALID352',target);
 IF r->>'error' IS DISTINCT FROM 'TOKEN_INVALID' THEN RAISE EXCEPTION 'status352_invalid_token';END IF;
 r:=public.fnb_guest_order_status(token_a,cash_id);
 IF r->>'bank_source' IS DISTINCT FROM 'not_applicable' OR r->'bank' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'status352_cash_bank_leak';END IF;
 PERFORM set_config('role','none',true);
END $$;
SAVEPOINT tenant352;
DO $$ DECLARE owner_id uuid:=gen_random_uuid();club uuid:=gen_random_uuid();physical uuid;token text:='LOCAL352-'||gen_random_uuid();target uuid;r jsonb;BEGIN
 INSERT INTO auth.users(id) VALUES(owner_id);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Guest352 cross-club TEST','TEST','approved');
 INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES(club,false) ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=false;
 SELECT id INTO physical FROM public.game_tables WHERE club_id=club AND table_number=30;
 IF physical IS NULL THEN RAISE EXCEPTION 'tenant352_no_canonical_table';END IF;
 INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,physical,token,true);
 SELECT order_id INTO target FROM fnb352_target;
 PERFORM set_config('role','anon',true);
 r:=public.fnb_guest_order_status(token,target);
 IF r->>'error' IS DISTINCT FROM 'ORDER_NOT_FOUND' THEN RAISE EXCEPTION 'status352_cross_club';END IF;
 PERFORM set_config('role','none',true);
END $$;
ROLLBACK TO tenant352;
SELECT 'FNB352_SNAPSHOT_LEGACY_MALFORMED_DUPLICATE_MISMATCH_REVOKED_SCOPE_ACL_PASS_ROLLBACK';
