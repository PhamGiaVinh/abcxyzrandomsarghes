DO $$ DECLARE b record;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 SELECT * INTO STRICT b FROM floor_private.bag_reconciliation_authority_backup267;
 ASSERT pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=b.after_definition,'bag618_recovery_source_drift';
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=b.before_acl;
 EXECUTE b.before_definition;
 ASSERT pg_get_functiondef('public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=b.before_definition;
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid='public.chip_ops_day_reconcile(uuid,integer)'::regprocedure)=b.before_acl;
END $$;
