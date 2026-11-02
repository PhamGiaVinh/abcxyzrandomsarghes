-- Synthetic TTL boundary times on new fixture orders, NOT wall-clock cron proof.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT has_function_privilege('anon','public.fnb_expire_pending_orders()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.fnb_expire_pending_orders()','EXECUTE');
 ASSERT has_function_privilege('service_role','public.fnb_expire_pending_orders()','EXECUTE');
END $$;
CREATE TEMP TABLE fnb796_money_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_ingredients x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_stock_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x WHERE status IN('paid','shipped')),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_cashier_shifts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x)
)::text) fingerprint;
DO $$ DECLARE club uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); menu uuid:=gen_random_uuid();
 ids uuid[]:='{}'; result jsonb; i integer; expired_count integer; event_count integer;
BEGIN
 INSERT INTO auth.users(id) VALUES(actor);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,actor,'LOCAL796 rollback TTL TEST','TEST','approved');
 INSERT INTO public.fnb_settings(club_id,pending_ttl_secs,guest_bank_ttl_secs) VALUES(club,900,1800);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(menu,club,'LOCAL796 pending item',5000,true,false);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 FOR i IN 1..4 LOOP
  PERFORM set_config('role','authenticated',true);
  result:=public.fnb_create_order(club,'counter',NULL,'LOCAL796 TEST',NULL,
    jsonb_build_array(jsonb_build_object('menu_item_id',menu,'qty',1)),gen_random_uuid()::text,NULL,NULL);
  ASSERT result->>'status'='ok',result::text;
  ids:=array_append(ids,(result->>'order_id')::uuid);
  PERFORM set_config('role','none',true);
 END LOOP;
 -- Adjust only NEW fixture metadata, never old orders or the original journeys.
 UPDATE public.fnb_orders SET created_at=now()-interval '901 seconds' WHERE id=ids[1];
 UPDATE public.fnb_orders SET created_at=now()-interval '900 seconds' WHERE id=ids[2];
 UPDATE public.fnb_orders SET created_at=now()-interval '901 seconds',payment_method='bank_transfer' WHERE id=ids[3];
 UPDATE public.fnb_orders SET created_at=now()-interval '1801 seconds',payment_method='bank_transfer' WHERE id=ids[4];
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM set_config('role','service_role',true);
 expired_count:=public.fnb_expire_pending_orders();
 PERFORM set_config('role','none',true);
 ASSERT expired_count>=2;
 ASSERT (SELECT status='expired' FROM public.fnb_orders WHERE id=ids[1]);
 ASSERT (SELECT status='pending' FROM public.fnb_orders WHERE id=ids[2]),'strict TTL boundary expired early';
 ASSERT (SELECT status='pending' FROM public.fnb_orders WHERE id=ids[3]),'bank order used cash TTL';
 ASSERT (SELECT status='expired' FROM public.fnb_orders WHERE id=ids[4]);
 SELECT count(*) INTO event_count FROM public.fnb_order_events WHERE order_id=ANY(ids) AND action='expired';
 ASSERT event_count=2;
 PERFORM set_config('role','service_role',true);
 ASSERT public.fnb_expire_pending_orders()=0,'same tick expires twice';
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*) FROM public.fnb_order_events WHERE order_id=ANY(ids) AND action='expired')=event_count;
 ASSERT (SELECT fingerprint FROM fnb796_money_before)=md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_ingredients x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_stock_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x WHERE status IN('paid','shipped')),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_cashier_shifts x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x)
 )::text),'expiry changed inventory or cashier money';
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='LOCAL796 rollback TTL TEST'),'fixture survived rollback';
END $$;
SELECT 'FNB796_NATIVE_CASH_BANK_TTL_STRICT_BOUNDARY_EXPIRE_ONCE_NO_STOCK_CASH_DELTA_CLONE_ALL_ROLLBACK_PASS';
