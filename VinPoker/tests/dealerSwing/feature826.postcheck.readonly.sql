\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE r private.dealer_feature_config_receipts_v1; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT * INTO STRICT r FROM private.dealer_feature_config_receipts_v1 WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND request_id='b398acb5-2488-4dc2-aa4a-86a07dbe1c38';
 ASSERT r.table_id='e207a6a7-8b2e-4e6d-92dc-26cf0bd408d2' AND r.club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 ASSERT r.payload=jsonb_build_object('club_id',r.club_id,'table_id',r.table_id,'table_mode','normal','is_final',false,'allow_override',true,'members','[]'::jsonb);
 ASSERT r.result=jsonb_build_object('status','cancelled','club_id',r.club_id,'table_id',r.table_id,'request_id',r.request_id,'profile',r.payload-'club_id'-'table_id');
 ASSERT (SELECT count(*)=1 FROM private.dealer_feature_config_receipts_v1 WHERE table_id=r.table_id);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id=r.table_id);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_pool_members WHERE table_id=r.table_id);
 ASSERT (SELECT count(*)=1 FROM public.audit_logs WHERE entity_id::text=r.table_id::text);
 ASSERT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id::text=r.table_id::text AND action='cancel_table_dealer_profile' AND payload->>'request_id'=r.request_id::text);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id=r.table_id AND closed_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=r.table_id AND released_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.app_settings WHERE key='dealer_feature_tables_enabled');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000291');
END $$;
ROLLBACK;
SELECT 'FEATURE826_BROWSER_CANCEL_TOMBSTONE_LATE_SAVE_ONE_RECEIPT_ONE_AUDIT_ZERO_PROFILE_POOL_SESSION_ASSIGNMENT_PASS';
