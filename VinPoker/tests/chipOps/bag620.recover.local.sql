DO $$ DECLARE b record;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM floor_private.bag_table_label_backup268)=3;
 FOR b IN SELECT * FROM floor_private.bag_table_label_backup268 LOOP
  ASSERT pg_get_functiondef(to_regprocedure(b.signature))=b.after_definition,'bag620_recovery_definition_drift';
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(b.signature)) IS NOT DISTINCT FROM b.after_acl;
 END LOOP;
 FOR b IN SELECT * FROM floor_private.bag_table_label_backup268 WHERE before_definition IS NOT NULL LOOP
  EXECUTE b.before_definition;
  ASSERT pg_get_functiondef(to_regprocedure(b.signature))=b.before_definition;
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(b.signature)) IS NOT DISTINCT FROM b.before_acl;
 END LOOP;
 DROP FUNCTION floor_private.chip_bag_table_label_v1(uuid,uuid,uuid,uuid);
END $$;
