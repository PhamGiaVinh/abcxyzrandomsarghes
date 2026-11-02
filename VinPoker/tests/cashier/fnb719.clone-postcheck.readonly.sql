\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
  'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT to_regprocedure('floor_private.fnb_cash_gate718(uuid)') IS NOT NULL;
 ASSERT NOT has_function_privilege('anon','floor_private.fnb_cash_gate718(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','floor_private.fnb_cash_gate718(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.fnb_cash_gate718(uuid)','EXECUTE');
 ASSERT (SELECT count(*)=2 AND bool_and(status='cancelled' AND subtotal_vnd=5000 AND cogs_vnd=2000)
  FROM public.fnb_orders WHERE id IN('81a54bb5-f62d-4c6c-97ed-2314514dd845','5ec265a7-a3aa-4aa9-9c83-ffb76ff53a6f'));
 ASSERT (SELECT count(*)=2 AND bool_and(on_hand=10) FROM public.fnb_ingredients
  WHERE id IN('62ab8cbc-c339-40a4-998b-05dd747432ec','f53a30c9-827d-451b-b8e7-1115e629c95d'));
 ASSERT (SELECT count(*)=4 AND sum(delta)=0 FROM public.fnb_stock_movements
  WHERE ref_id IN('81a54bb5-f62d-4c6c-97ed-2314514dd845','5ec265a7-a3aa-4aa9-9c83-ffb76ff53a6f'));
 ASSERT EXISTS(SELECT 1 FROM public.fnb_orders WHERE id='038516b7-8d50-489f-bd0f-370dcf6b266a' AND status='cancelled' AND subtotal_vnd=5000 AND cogs_vnd=2000);
 ASSERT EXISTS(SELECT 1 FROM public.fnb_ingredients WHERE id='ca7c52e6-4bce-47d4-b7fa-d4fd0a59fe21' AND on_hand=10);
 ASSERT (SELECT count(*)=2 AND sum(delta)=0 FROM public.fnb_stock_movements WHERE ref_id='038516b7-8d50-489f-bd0f-370dcf6b266a');
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL,'do not claim a complete shift backend';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid());
END $$;
ROLLBACK;
SELECT 'FNB719_OWNED_CLONE_ONLY_BASELINE_AND_GATED_CASH_COMPENSATED_NO_CLIENT_HELPER_GRANTS_NO_IDLE_TX';
