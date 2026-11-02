\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE b record;p pg_proc;name text;digest text;BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT b FROM private.swing831_install WHERE id AND source_sha256='c8ec6d9808866598809550e6164490677b425147635cee243d6230fa906620ce';
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
 ASSERT md5(pg_get_functiondef(p.oid))=b.installed_digest AND b.installed_digest='09e3310fc3261a39cf05a6d44af14f3f';
 ASSERT md5(b.old_catalog->>'definition')='54dfcbdc56d3c412d1170d8996ca22c9';
 ASSERT p.proowner=(b.old_catalog->>'owner_id')::oid AND coalesce(to_jsonb(p.proacl),'null'::jsonb)=b.old_catalog->'acl'
  AND coalesce(to_jsonb(p.proconfig),'null'::jsonb)=b.old_catalog->'settings';
 ASSERT NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE');
 FOR name IN SELECT jsonb_object_keys(b.facts) LOOP
  IF name='dealer_swing_operator_requests' THEN
   SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'null')) INTO digest
    FROM public.dealer_swing_operator_requests x WHERE request_id<>'1ea3ebb6-ceab-474c-8570-44ee0aa16760';
  ELSE
   EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,''null'')) FROM public.%I x',name) INTO digest;
  END IF;
  ASSERT digest=b.facts->>name,'831 changed protected facts: '||name;
 END LOOP;
 ASSERT (SELECT count(*) FROM public.dealer_swing_operator_requests WHERE request_id='1ea3ebb6-ceab-474c-8570-44ee0aa16760'
  AND actor_user_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b'
  AND table_id='53637b3a-b553-472f-830d-6e7ede661f6f' AND table_session_id='697d9aed-5faa-4a53-a193-2caa4a849e27'
  AND assignment_id='e5991944-e849-4e32-8076-fc1e4432587f' AND expected_version=0 AND completed_at IS NOT NULL
  AND response=jsonb_build_object('outcome','error','detail','SWING831_INJECTED_ACQUISITION_FAILURE','sqlstate','P0001'))=1;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('swing830_fault','swing831_fault'));
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000293');
END $$;
ROLLBACK;
SELECT 'SWING831_INSTALLED_BODY_EXACT_ERROR_RECEIPT_15_FACT_GROUPS_PRESERVED_AUTO_OFF_PASS';
