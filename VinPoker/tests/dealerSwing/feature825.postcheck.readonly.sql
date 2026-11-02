\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE p jsonb;e jsonb;r private.dealer_feature_config_receipts_v1; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT proof INTO STRICT p FROM private.feature825_install WHERE id AND source_hash='3ed72d6e9f3d332e762ce09dd843e2b033bfdafc25d3937e6d469b39edbe7c0c';
 ASSERT jsonb_array_length(p->'orders')=2;
 ASSERT md5(pg_get_functiondef('public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)'::regprocedure))='e1b8cfd5444eb77edd2f04f54a79c9bc';
 ASSERT md5(pg_get_functiondef('public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)'::regprocedure))='a07285426eba0aa1e68a3ab056f024cc';
 ASSERT md5(pg_get_functiondef('public.get_table_dealer_profile_receipt_v2(uuid,uuid,uuid)'::regprocedure))='5c1c090e01356086c077666a7147f816';
 FOR e IN SELECT * FROM jsonb_array_elements(p->'orders') LOOP
  ASSERT (e->>'actual_lock')::boolean AND e->'holder'=e->'waiter';
  SELECT * INTO STRICT r FROM private.dealer_feature_config_receipts_v1 WHERE request_id=(e->>'request_id')::uuid AND actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
  ASSERT r.table_id=(p->>'physical')::uuid;
  ASSERT r.result||jsonb_build_object('actor_id',r.actor_id)=e->'holder';
  ASSERT r.result->>'status'=CASE WHEN e->>'first'='cancel' THEN 'cancelled' ELSE 'saved' END;
 END LOOP;
 ASSERT (SELECT count(*)=2 FROM private.dealer_feature_config_receipts_v1 WHERE table_id=(p->>'physical')::uuid);
 ASSERT (SELECT count(*)=3 FROM public.audit_logs WHERE entity_id::text=p->>'physical');
 ASSERT (SELECT table_mode='normal' AND NOT is_final AND NOT allow_override FROM public.dealer_table_profiles WHERE table_id=(p->>'physical')::uuid);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id=(p->>'physical')::uuid AND closed_at IS NULL);
 ASSERT NOT has_function_privilege('authenticated','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_table_dealer_profile_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000291');
 ASSERT NOT EXISTS(SELECT 1 FROM public.app_settings WHERE key='dealer_feature_tables_enabled');
END $$;
ROLLBACK;
SELECT 'FEATURE825_TWO_COMMITTED_CANCEL_SAVE_LOCK_ORDERS_IMMUTABLE_RECEIPTS_ACTOR_ACL_FLAG_OFF_PASS';
