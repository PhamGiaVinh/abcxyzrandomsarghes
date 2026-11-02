\set ON_ERROR_STOP on
-- Diagnostic, not acceptance: demonstrate the two-RPC boundary without committing.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database')='VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948' FROM pg_database WHERE datname=current_database());
 ASSERT EXISTS(SELECT 1 FROM public.game_tables WHERE id='e532db28-8841-48b0-8972-a9355f1dabe3' AND club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND table_number=100);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id='e532db28-8841-48b0-8972-a9355f1dabe3');
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id='e532db28-8841-48b0-8972-a9355f1dabe3' AND closed_at IS NULL);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT public.set_table_dealer_mode('e532db28-8841-48b0-8972-a9355f1dabe3','feature',false,false);
DO $$ BEGIN
 BEGIN
  -- Explicit second-operation fault. The actual UI forbids an empty special pool;
  -- this is a native transaction-boundary diagnostic, not a UI reproduction.
  PERFORM public.set_table_dealer_pool('e532db28-8841-48b0-8972-a9355f1dabe3','[]'::jsonb);
  RAISE EXCEPTION 'expected second RPC failure';
 EXCEPTION WHEN SQLSTATE 'DT007' THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id='e532db28-8841-48b0-8972-a9355f1dabe3' AND table_mode='feature');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_pool_members WHERE table_id='e532db28-8841-48b0-8972-a9355f1dabe3');
 ASSERT (SELECT count(*)=1 FROM public.audit_logs WHERE entity_id::text='e532db28-8841-48b0-8972-a9355f1dabe3' AND action='set_table_dealer_mode');
END $$;
SELECT 'FEATURE820_PARTIAL_MODE_WITHOUT_POOL_REPRODUCED_NOT_FIXED';
ROLLBACK;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_table_profiles WHERE table_id='e532db28-8841-48b0-8972-a9355f1dabe3');
 ASSERT NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id::text='e532db28-8841-48b0-8972-a9355f1dabe3' AND action='set_table_dealer_mode');
END $$;
SELECT 'FEATURE820_FULL_ROLLBACK_NO_PROFILE_OR_AUDIT_DELTA';
