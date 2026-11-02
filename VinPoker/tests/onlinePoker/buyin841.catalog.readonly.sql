\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT to_regclass('public.online_poker_buyins') IS NULL,'catalog changed: qualify installed ledger instead';
 ASSERT md5(pg_get_functiondef('public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure))='1e522dbfcbaa77628b231351fb1fb4e4';
 ASSERT md5(pg_get_functiondef('public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)'::regprocedure))='44a816ef45c75b8d49307989932a6da2';
 ASSERT md5(pg_get_functiondef('public.op_sit_open(uuid,integer,bigint,text)'::regprocedure))='99147d3d3aabb72ffbf8e4e7b893dc41';
 ASSERT md5(pg_get_functiondef('public.op_rebuy_open(uuid,bigint,text)'::regprocedure))='027dafec25c84b40d8f9637ac6ecc3ea';
 ASSERT NOT has_function_privilege('authenticated','public.op_create_open_table(text,bigint,bigint,bigint,integer)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM public.online_poker_config),'runtime must stay disabled';
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  EXECUTE 'SELECT user_id,amount,created_at FROM public.online_poker_buyins LIMIT 1';
  RAISE EXCEPTION 'ledger unexpectedly became available';
 EXCEPTION WHEN undefined_table THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'BUYIN841_NATIVE_MISSING_LEDGER_CONFIRMED_NOT_FEATURE_PASS_LEGACY_CREATE_STILL_DENIED';
