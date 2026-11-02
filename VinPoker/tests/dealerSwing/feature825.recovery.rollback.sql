\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)'::regprocedure))='a07285426eba0aa1e68a3ab056f024cc';
END $$;
REVOKE EXECUTE ON FUNCTION public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid) FROM authenticated;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('authenticated','public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.get_table_dealer_profile_receipt_v2(uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.set_table_dealer_mode(uuid,text,boolean,boolean)','EXECUTE');
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT has_function_privilege('authenticated','public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.cancel_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)','EXECUTE');
END $$;
SELECT 'FEATURE825_V2_WRITERS_SUSPENDED_RECEIPT_READ_PRESERVED_LEGACY_DENIED_RECOVERY_ROLLBACK_PASS';
