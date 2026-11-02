\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE r record; BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 SELECT * INTO STRICT r FROM private.dealer_feature_config_receipts_v1
 WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND request_id='8278a778-6950-4281-9988-7331c5274a72';
 ASSERT r.table_id='394ee596-d625-49a4-9899-2d167f110d24' AND r.club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 ASSERT r.payload=jsonb_build_object('club_id',r.club_id,'table_id',r.table_id,'table_mode','normal','is_final',false,'allow_override',true,'members','[]'::jsonb);
 ASSERT r.result=jsonb_build_object('status','saved','request_id',r.request_id,'club_id',r.club_id,'table_id',r.table_id,'profile',r.payload-'club_id'-'table_id');
 ASSERT (SELECT count(*)=1 FROM private.dealer_feature_config_receipts_v1 WHERE table_id=r.table_id);
 ASSERT (SELECT table_mode='normal' AND NOT is_final AND allow_override FROM public.dealer_table_profiles WHERE table_id=r.table_id);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_pool_members WHERE table_id=r.table_id);
 ASSERT (SELECT count(*)=2 FROM public.audit_logs WHERE entity_id::text=r.table_id::text AND action IN('set_table_dealer_mode','set_table_dealer_pool'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id=r.table_id AND closed_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_id=r.table_id AND released_at IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.app_settings WHERE key='dealer_feature_tables_enabled');
 ASSERT NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000290');
END $$;
ROLLBACK;
SELECT 'FEATURE823_BROWSER_REQUEST_ONE_RECEIPT_TWO_AUDITS_SAVED_PROFILE_NO_OPEN_SESSION_ASSIGNMENT_FLAG_PASS';
