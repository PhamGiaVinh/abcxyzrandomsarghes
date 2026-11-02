\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE p jsonb;r jsonb; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT (SELECT source_hash='23ca3bdb00d2e0d098401d1e6eba153f67de0c2ea822fa07708f97a96c305dc8' AND jsonb_array_length(old_catalog)=2 FROM private.feature822_install WHERE id);
 SELECT proof INTO STRICT p FROM private.feature822_install WHERE id;
 ASSERT jsonb_array_length(p->'orders')=5 AND (SELECT bool_and((e->>'actual_lock')::boolean) FROM jsonb_array_elements(p->'orders')e);
 ASSERT md5(pg_get_functiondef('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)'::regprocedure))='1447eca27159c475ff37a3480d836cb7';
 ASSERT md5(pg_get_functiondef('public.get_table_dealer_profile_receipt_v1(uuid,uuid)'::regprocedure))='8d885cd171abd29a8df9886b80175a6e';
 SELECT result INTO STRICT r FROM private.dealer_feature_config_receipts_v1 WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND request_id=(p->>'request_id')::uuid;
 ASSERT r=p->'result';
 -- The823 browser canary adds a DIFFERENT table receipt; preserve this original
 -- immutable request's proof instead of treating all future configuration as drift.
 ASSERT (SELECT count(*)=1 FROM private.dealer_feature_config_receipts_v1 WHERE table_id=(r->>'table_id')::uuid);
 ASSERT (SELECT count(*)=2 FROM public.audit_logs WHERE entity_id::text=r->>'table_id' AND action IN('set_table_dealer_mode','set_table_dealer_pool'));
 ASSERT (SELECT table_mode='feature' AND NOT is_final AND NOT allow_override FROM public.dealer_table_profiles WHERE table_id=(r->>'table_id')::uuid);
 ASSERT (SELECT jsonb_agg(jsonb_build_object('dealer_id',dealer_id,'priority',priority,'is_primary',is_primary) ORDER BY priority)=r#>'{profile,members}' FROM public.dealer_table_pool_members WHERE table_id=(r->>'table_id')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id=(r->>'table_id')::uuid AND closed_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=(r->>'table_id')::uuid AND released_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6');
 ASSERT NOT EXISTS(SELECT 1 FROM public.app_settings WHERE key='dealer_feature_tables_enabled');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000290');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_mode(uuid,text,boolean,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_pool(uuid,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
END $$;
ROLLBACK;
SELECT 'FEATURE822_COMMITTED_RECEIPT_FIVE_ACTUAL_LOCK_ORDERS_CURRENT_PROFILE_ACL_NO_ASSIGNMENT_FLAG_LEDGER_PASS';
