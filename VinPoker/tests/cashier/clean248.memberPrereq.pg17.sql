\set ON_ERROR_STOP on
-- Local TEST metadata only; no registration/payment/entry/seat/provider call.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c'
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55441
 OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'))
 THEN RAISE EXCEPTION 'isolated_clean248_only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682
  WHERE fixture->>'tour'='c367013a-3ed3-48af-ad48-3915acadc50e'
   AND fixture->>'player'='a11b1317-4885-4835-8d2e-fb435f7b24e2')
 OR EXISTS(SELECT 1 FROM public.tournament_registrations WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')
 OR NOT EXISTS(SELECT 1 FROM public.stack_template_issuance WHERE stack_template_id='ae128140-48dc-4773-8c96-87a6e0d90219' AND issued_count=8 AND revision=1)
 THEN RAISE EXCEPTION 'exact_pre_registration_issued8_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_bank_accounts WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b')
 THEN RAISE EXCEPTION 'do_not_replace_existing_bank_metadata'; END IF;
 INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,notes)
 VALUES('d4427834-5f5f-48ef-bde5-e2dc388ed00b','LOCAL_TEST_NO_BANK','CLEAN248_NOT_PAYABLE','LOCAL TEST ONLY',
  'Synthetic non-payable metadata for isolated browser registration; no BIN, QR, provider, credentials or real account.');
END $$;
COMMIT;
SELECT 'CLEAN248_NON_PAYABLE_BANK_METADATA_ONLY_READY';
