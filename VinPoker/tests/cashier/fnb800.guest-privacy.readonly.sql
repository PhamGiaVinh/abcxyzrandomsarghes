-- QR tokens remain inside this local read-only transaction; never print them.
\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='8s';
DO $$ DECLARE own_token public.fnb_table_qr_tokens;other_token public.fnb_table_qr_tokens;same_club_token public.fnb_table_qr_tokens;
 guest_order public.fnb_orders;counter_order uuid;response jsonb;
BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT has_function_privilege('anon','public.fnb_guest_order_status(text,uuid)','EXECUTE');
 SELECT o.* INTO STRICT guest_order FROM public.fnb_orders o JOIN public.fnb_table_qr_tokens q ON q.id=o.qr_token_id
  WHERE o.payment_method='cash' AND o.status='pending'
   AND EXISTS(SELECT 1 FROM public.fnb_table_qr_tokens q2 WHERE q2.club_id=q.club_id AND q2.id<>q.id)
  ORDER BY o.id LIMIT 1;
 SELECT * INTO STRICT own_token FROM public.fnb_table_qr_tokens WHERE id=guest_order.qr_token_id;
 SELECT * INTO STRICT other_token FROM public.fnb_table_qr_tokens WHERE club_id<>own_token.club_id ORDER BY id LIMIT 1;
 SELECT * INTO STRICT same_club_token FROM public.fnb_table_qr_tokens WHERE club_id=own_token.club_id AND id<>own_token.id ORDER BY id LIMIT 1;
 SELECT (fixture->>'a')::uuid INTO STRICT counter_order FROM floor_private.fnb799_commit_fixture;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM set_config('role','anon',true);
 response:=public.fnb_guest_order_status(own_token.token,guest_order.id);
 ASSERT response->>'status'='ok';
 ASSERT response->'order'->>'id'=guest_order.id::text;
 ASSERT response->'order'->>'order_status'=guest_order.status::text;
 ASSERT response->'order'->'subtotal_vnd'=to_jsonb(guest_order.subtotal_vnd);
 ASSERT response->'bank'='null'::jsonb AND response->>'bank_source'='not_applicable';
 ASSERT NOT (response->'order' ?| ARRAY['customer_name','note','club_id','created_by','paid_by','cogs_vnd','qr_token_id']);
 ASSERT public.fnb_guest_order_status(other_token.token,guest_order.id)='{"error":"ORDER_NOT_FOUND"}'::jsonb;
 ASSERT public.fnb_guest_order_status(same_club_token.token,guest_order.id)='{"error":"ORDER_NOT_FOUND"}'::jsonb;
 ASSERT public.fnb_guest_order_status('LOCAL800-NO-SUCH-TOKEN',guest_order.id)='{"error":"TOKEN_INVALID"}'::jsonb;
 -- An arbitrary paid counter order cannot be adopted just by knowing its UUID.
 ASSERT public.fnb_guest_order_status(own_token.token,counter_order)='{"error":"ORDER_NOT_FOUND"}'::jsonb;
 ASSERT public.fnb_guest_order_status(own_token.token,gen_random_uuid())='{"error":"ORDER_NOT_FOUND"}'::jsonb;
END $$;
ROLLBACK;
SELECT 'FNB800_NATIVE_ANON_QR_INVOICE_EXACT_TOKEN_FOREIGN_CLUB_INVALID_COUNTER_UUID_DENIED_NO_PRIVATE_FIELDS_READONLY_PASS';
