\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT to_regprocedure('floor_private.fnb_cash_gate718(uuid)') IS NULL,'prototype helper must be rolled back';
 ASSERT md5(pg_get_functiondef('public.fnb_mark_paid(uuid,text)'::regprocedure))='c8d1b825e471fab2038c0552532dbc15';
 ASSERT md5(pg_get_functiondef('public.fnb_cancel_order(uuid,text)'::regprocedure))='7a40b0d5f0103b4dbcf7848079aca94b';
 ASSERT md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))='779c15e9a2763eb2c8b7b0c0aaea7206';
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_menu_items WHERE name='LOCAL718 rollback item');
 ASSERT NOT EXISTS(SELECT 1 FROM public.fnb_ingredients WHERE name='LOCAL718 rollback ingredient');
 ASSERT to_regclass('public.fnb_cashier_shifts') IS NULL;
 ASSERT NOT has_table_privilege('authenticated','public.fnb_orders','INSERT');
 ASSERT NOT has_table_privilege('authenticated','public.fnb_orders','UPDATE');
 ASSERT NOT has_table_privilege('authenticated','public.fnb_orders','DELETE');
END $$;
ROLLBACK;
SELECT 'FNB718_EXACT_THREE_ORIGINAL_WRITERS_RESTORED_NO_HELPER_OR_FIXTURE_NO_NEW_GRANTS';
