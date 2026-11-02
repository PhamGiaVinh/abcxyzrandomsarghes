\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE b record;p pg_proc;s text; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM private.fallback829_install WHERE id AND source_sha256='e88c694345bfd208c892af9c6364694abb9b024977df4913f568a429f3170630';
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
 s:=pg_get_functiondef(p.oid);
 ASSERT md5(s)=b.installed_digest AND md5(b.old_catalog->>'definition')='58430628220aa26d854fdab0694394bd';
 ASSERT p.proowner=(b.old_catalog->>'owner_id')::oid;
 ASSERT coalesce(to_jsonb(p.proacl),'null'::jsonb)=b.old_catalog->'acl';
 ASSERT coalesce(to_jsonb(p.proconfig),'null'::jsonb)=b.old_catalog->'settings';
 ASSERT position('floor_private.dealer_pool_attendance_matches_v1(dat.dealer_id, v_club_id, pg_catalog.statement_timestamp())' IN s)>0;
 ASSERT NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND auto_swing_enabled);
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000292');
END $$;
ROLLBACK;
SELECT 'FALLBACK829_INSTALLED_BODY_PREDECESSOR_OWNER_ACL_PATH_UNCHANGED_AUTO_OFF_LEDGER_ZERO_PASS';
