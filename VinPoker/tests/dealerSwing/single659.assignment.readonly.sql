\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='808821c8-7611-424e-934a-9ce262af139a' AND dealer_id='e6420000-0000-4000-8000-000000000003' AND table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01' AND table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND status='assigned' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='dfebfb3c-d6bc-437b-a400-0d0b6a9f086a' AND table_session_id='0aab12d1-b855-4014-9f22-1dc59719c7e2' AND status='completed' AND released_at IS NOT NULL);
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE table_id='29b12a26-6987-4bfa-810f-bfc64d13ef01' AND released_at IS NULL AND status='assigned')=1;
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a' AND current_state='assigned' AND status='checked_in');
 ASSERT EXISTS(SELECT 1 FROM floor_private.dealer_initial_assign_receipts WHERE request_key='open_manual_febf2b51-fdb7-42ff-886c-b3bb1fffdc3e_a71cb8ce-cec4-47e9-bd47-59f6e5e258ab' AND payload->>'session'='f60106c2-7ed5-4be3-8512-602b16eddff3' AND result->>'assignment_id'='808821c8-7611-424e-934a-9ce262af139a' AND result->>'outcome'='ok');
END $$;
COMMIT;
SELECT 'SINGLE659_NEW_SESSION_ASSIGNMENT_RECEIPT_OLD_ASSIGNMENT_PRESERVED_PASS';
