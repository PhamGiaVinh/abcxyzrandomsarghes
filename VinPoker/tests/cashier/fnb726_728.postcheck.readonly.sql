\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ DECLARE f jsonb;base jsonb;fixed jsonb;signature text;BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT fixture INTO STRICT f FROM floor_private.fnb726_fixture;
 ASSERT f->>'test_only'='true' AND f->>'state'='qualified';
 ASSERT (SELECT count(*)=100 FROM public.game_tables WHERE club_id=(f->>'club')::uuid);
 ASSERT (SELECT count(*)=2 FROM public.fnb_cashier_shifts WHERE club_id=(f->>'club')::uuid AND status='closed' AND expected_cash_vnd=0 AND variance_vnd=0);
 ASSERT (SELECT count(*)=7 FROM floor_private.fnb_shift_intents722 WHERE actor=(f->>'actor')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.fnb_shift_intents722 WHERE actor=(f->>'cashier')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_fnb_staff WHERE club_id=(f->>'club')::uuid AND user_id=(f->>'cashier')::uuid);
 ASSERT (SELECT response->>'status'='cancelled' FROM floor_private.fnb_shift_intents722 WHERE actor=(f->>'actor')::uuid AND request_id='726-cancel-open');
 ASSERT (SELECT response->>'status'='ok' FROM floor_private.fnb_shift_intents722 WHERE actor=(f->>'actor')::uuid AND request_id='726-applied-close');
 FOREACH signature IN ARRAY ARRAY['public.fnb_open_shift_v2(uuid,bigint,text,uuid)','public.fnb_close_shift_v2(uuid,bigint,text,text,uuid)',
  'public.fnb_get_shift_intent_v1(uuid,text,uuid)','public.fnb_cancel_shift_intent_v1(uuid,text,uuid,bigint,text,text,uuid)'] LOOP
  ASSERT has_function_privilege('authenticated',signature,'EXECUTE');
  ASSERT NOT has_function_privilege('anon',signature,'EXECUTE') AND NOT has_function_privilege('service_role',signature,'EXECUTE');
 END LOOP;
 ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_open_shift_core725(uuid,bigint,text)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_close_shift_core725(uuid,bigint,text,text)','EXECUTE');
 SELECT fixture INTO STRICT base FROM floor_private.fnb728_fixtures WHERE phase='baseline';
 SELECT fixture INTO STRICT fixed FROM floor_private.fnb728_fixtures WHERE phase='fixed';
 ASSERT base->'result'->>'status'='ok' AND base->>'stock'='8';
 ASSERT (SELECT status='paid' AND is_comp AND subtotal_vnd=0 AND cogs_vnd=2000 FROM public.fnb_orders WHERE id=(base->'result'->>'order_id')::uuid);
 ASSERT (SELECT on_hand=8 FROM public.fnb_ingredients WHERE id=(base->>'ingredient')::uuid),'preserve failed baseline';
 ASSERT (SELECT count(*)=1 FROM public.fnb_create_intents_v1 WHERE club_id=(base->>'club')::uuid AND request_id='728-comp');
 ASSERT fixed->'result'->>'error'='Forbidden' AND fixed->>'stock'='10';
 ASSERT (SELECT on_hand=10 FROM public.fnb_ingredients WHERE id=(fixed->>'ingredient')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=(fixed->>'club')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_create_intents_v1 WHERE club_id=(fixed->>'club')::uuid AND request_id='728-comp');
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_stock_movements WHERE ingredient_id=(fixed->>'ingredient')::uuid);
 ASSERT md5(pg_get_functiondef('public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure))='5e92d765ed352629a05eb98092d0b64d';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid());
END $$;
ROLLBACK;
SELECT 'FNB726_RECOVERY_FACTS_AND_FNB728_RED_PRESERVED_FIXED_NO_ORDER_INTENT_STOCK_PASS';
