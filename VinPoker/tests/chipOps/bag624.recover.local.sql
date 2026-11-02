DO $$ DECLARE b record;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT count(*) FROM floor_private.bag_day_lock_backup269)=5;
 FOR b IN SELECT * FROM floor_private.bag_day_lock_backup269 LOOP
  ASSERT pg_get_functiondef(to_regprocedure(b.signature))=b.after_definition;
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(b.signature)) IS NOT DISTINCT FROM b.after_acl;
 END LOOP;
 FOR b IN SELECT * FROM floor_private.bag_day_lock_backup269 WHERE before_definition IS NOT NULL LOOP
  EXECUTE b.before_definition;
  ASSERT pg_get_functiondef(to_regprocedure(b.signature))=b.before_definition;
 END LOOP;
 DROP FUNCTION floor_private.lock_chip_bag_day_v1(uuid,integer);
END $$;
