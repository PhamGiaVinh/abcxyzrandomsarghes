\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
-- Direct-text writer discovery; dynamic SQL/Edge callers still require tracing.
SELECT jsonb_build_object('writer',p.oid::regprocedure::text,'definition_md5',md5(pg_get_functiondef(p.oid)),
 'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN('public','private','floor_private')
 AND p.prosrc ~* '(insert[[:space:]]+into|update)[[:space:]]+(public[.])?fnb_orders'
ORDER BY n.nspname,p.proname,p.oid;
SELECT jsonb_build_object('orders_rls',c.relrowsecurity,
 'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
 'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
 'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE'))
FROM pg_class c WHERE c.oid='public.fnb_orders'::regclass;
SELECT jsonb_build_object('trigger',t.tgname,'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid))
FROM pg_trigger t WHERE t.tgrelid='public.fnb_orders'::regclass AND NOT t.tgisinternal ORDER BY t.tgname;
ROLLBACK;
