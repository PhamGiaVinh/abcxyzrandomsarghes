-- Run after forward287 body inside the same transaction; end ROLLBACK, no install.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));
 ASSERT NOT has_function_privilege('anon','public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.op_get_create_receipt_v1(uuid)','EXECUTE');
END $$;
INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true) ON CONFLICT(id) DO UPDATE SET enabled=true;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE key uuid:=gen_random_uuid();denied_key uuid:=gen_random_uuid();a jsonb;b jsonb;found jsonb;BEGIN
 a:=public.op_create_open_table_v2('LOCAL768-KEYED',25,50,5000,9,key);
 b:=public.op_create_open_table_v2('LOCAL768-KEYED',25,50,5000,9,key);
 ASSERT a->>'outcome'='ok' AND b->>'outcome'='ok' AND a->>'table_id'=b->>'table_id' AND a->>'replayed'='false' AND b->>'replayed'='true';
 ASSERT (SELECT count(*)=1 FROM public.online_poker_tables WHERE name='LOCAL768-KEYED');
 found:=public.op_get_create_receipt_v1(key);
 ASSERT found->>'outcome'='found' AND found->'receipt'=a AND found->'payload'->>'buyin'='5000';
 BEGIN PERFORM public.op_create_open_table_v2('LOCAL768-DIFFERENT',25,50,5000,9,key);RAISE EXCEPTION 'payload conflict not rejected';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='online_create_request_conflict';END;
 BEGIN PERFORM public.op_create_open_table_v2('LOCAL768-KEYED',25,50,6000,9,key);RAISE EXCEPTION 'stack conflict not rejected';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='online_create_request_conflict';END;
 BEGIN PERFORM public.op_create_open_table_v2('LOCAL768-KEYED',25,50,5000,6,key);RAISE EXCEPTION 'capacity conflict not rejected';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='online_create_request_conflict';END;
 a:=public.op_create_open_table_v2('LOCAL768-DENIED',50,25,5000,9,denied_key);
 b:=public.op_create_open_table_v2('LOCAL768-DENIED',50,25,5000,9,denied_key);
 ASSERT a->>'outcome'='bad_blinds' AND b->>'outcome'='bad_blinds' AND b->>'replayed'='true';
 ASSERT NOT EXISTS(SELECT 1 FROM public.online_poker_tables WHERE name='LOCAL768-DENIED');
 BEGIN PERFORM 1 FROM private.online_create_requests_v1;RAISE EXCEPTION 'private direct read exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',true);
 PERFORM set_config('request.jwt.claims','{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}',true);
 ASSERT public.op_get_create_receipt_v1(key)->>'outcome'='not_found','other actor read receipt';
 PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 BEGIN PERFORM public.op_get_create_receipt_v1(key);RAISE EXCEPTION 'anonymous actor read accepted';EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='online_create_actor_required';END;
 RAISE NOTICE 'ONLINE768_KEYED_CREATE_REPLAY_PAYLOAD_STACK_CAPACITY_CONFLICT_DENIAL_READ_PRIVATE_ACTOR_PASS_ROLLBACK_ONLY';
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT count(*)=2 FROM private.online_create_requests_v1);END $$;
ROLLBACK;
SELECT to_regclass('private.online_create_requests_v1') IS NULL AS receipt_table_not_installed,
 to_regprocedure('public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)') IS NULL AS wrapper_not_installed,
 NOT EXISTS(SELECT 1 FROM public.online_poker_tables WHERE name LIKE 'LOCAL768-%') AS no_test_tables;
