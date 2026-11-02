\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ DECLARE b record; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*) FROM floor_private.dealer_operating_day_backup272)=1;
 SELECT * INTO STRICT b FROM floor_private.dealer_operating_day_backup272;
 ASSERT md5(replace(pg_get_functiondef(to_regprocedure(b.signature)),chr(13),''))=b.after_digest;
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(b.signature)) IS NOT DISTINCT FROM b.acl;
 EXECUTE b.definition;
 ASSERT md5(replace(pg_get_functiondef(to_regprocedure(b.signature)),chr(13),''))=b.before_digest;
 ASSERT (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(b.signature)) IS NOT DISTINCT FROM b.acl;
END $$;
COMMIT;
