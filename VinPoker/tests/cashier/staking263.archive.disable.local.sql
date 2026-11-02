-- LOCAL rollback posture: disable new entry point, retain every deal/audit/receipt.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.archive_staking_listing_v1(uuid,uuid,text)'::regprocedure))='83e12c114944a1e7deb4ff094278fffd';
END $$;
REVOKE EXECUTE ON FUNCTION public.archive_staking_listing_v1(uuid,uuid,text) FROM service_role;
DO $$ BEGIN ASSERT NOT has_function_privilege('service_role','public.archive_staking_listing_v1(uuid,uuid,text)','EXECUTE');END $$;
COMMIT;
