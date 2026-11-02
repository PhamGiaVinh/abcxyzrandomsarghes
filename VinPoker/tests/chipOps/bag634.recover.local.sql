\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ DECLARE v record;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*) FROM floor_private.bag_active_hand_backup271)=2;
 FOR v IN SELECT * FROM floor_private.bag_active_hand_backup271 LOOP
  ASSERT md5(replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),''))=v.after_digest;
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(v.signature)) IS NOT DISTINCT FROM v.acl;
 END LOOP;
 FOR v IN SELECT * FROM floor_private.bag_active_hand_backup271 LOOP
  EXECUTE v.definition;
  ASSERT md5(replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),''))=v.before_digest;
  ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(v.signature)) IS NOT DISTINCT FROM v.acl;
 END LOOP;
END $$;
COMMIT;
