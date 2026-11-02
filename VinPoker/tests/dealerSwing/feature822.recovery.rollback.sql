\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)'::regprocedure))='1447eca27159c475ff37a3480d836cb7';
 ASSERT (SELECT count(*)=1 FROM private.feature822_install WHERE id AND proof IS NOT NULL);
END $$;
-- Suspend only the new writer. Existing receipts stay readable; old unsafe
-- two-step setters stay inaccessible. This exercise itself is rolled back.
REVOKE EXECUTE ON FUNCTION public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid) FROM authenticated;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('authenticated','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.get_table_dealer_profile_receipt_v1(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_mode(uuid,text,boolean,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_pool(uuid,jsonb)','EXECUTE');
 ASSERT (SELECT count(*)=1 FROM private.dealer_feature_config_receipts_v1);
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT has_function_privilege('authenticated','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
END $$;
SELECT 'FEATURE822_SUSPEND_WRITER_PRESERVE_RECEIPT_NO_LEGACY_REENABLE_RECOVERY_ROLLBACK_PASS';
