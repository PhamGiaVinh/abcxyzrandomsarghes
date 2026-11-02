\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='10s';
DO $$ DECLARE b record; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM private.fallback829_install WHERE id;
 ASSERT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure))=b.installed_digest;
 ASSERT md5(b.old_catalog->>'definition')='58430628220aa26d854fdab0694394bd';
 EXECUTE b.old_catalog->>'definition';
 ASSERT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure))='58430628220aa26d854fdab0694394bd';
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure))=(SELECT installed_digest FROM private.fallback829_install WHERE id);
END $$;
SELECT 'FALLBACK829_EXACT_PREDECESSOR_RECOVERY_REHEARSED_ROLLBACK_NEW_BODY_REMAINS_PASS';
