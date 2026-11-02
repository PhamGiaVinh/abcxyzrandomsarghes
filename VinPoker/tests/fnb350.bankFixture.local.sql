\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE bank_id uuid:=gen_random_uuid();BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'))
 OR to_regclass('floor_private.fnb350_fixture') IS NOT NULL
 OR EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE club_id='ddcd5243-42be-49cf-897b-2027a35893e5')
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='ddcd5243-42be-49cf-897b-2027a35893e5' AND name='Guest335 concurrency TEST')
 THEN RAISE EXCEPTION 'exact_isolated350_fixture_only_no_reseed';END IF;
 INSERT INTO public.platform_bank_accounts(id,club_id,bank_name,account_number,account_holder,is_active,account_type)
 VALUES(bank_id,'ddcd5243-42be-49cf-897b-2027a35893e5','LOCAL TEST350 NOT A BANK','TEST-NON-BANK350','NO REAL ACCOUNT',true,'escrow');
 CREATE TABLE floor_private.fnb350_fixture(fixture jsonb NOT NULL);
 ALTER TABLE floor_private.fnb350_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.fnb350_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.fnb350_fixture VALUES(jsonb_build_object('club','ddcd5243-42be-49cf-897b-2027a35893e5','bank',bank_id,'fakeBank',true));
END $$;
SELECT 'LOCAL350_FAKE_BANK_METADATA_ONLY_NO_TRANSFER';
COMMIT;
