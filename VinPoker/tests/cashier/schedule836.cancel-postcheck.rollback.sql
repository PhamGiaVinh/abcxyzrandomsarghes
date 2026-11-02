\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
CREATE TEMP TABLE schedule836_ctx ON COMMIT DROP AS SELECT * FROM private.schedule836_fixture
 UNION ALL SELECT * FROM private.schedule837_fixture;
CREATE TEMP TABLE schedule836_before ON COMMIT DROP AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.table_operation_receipts r)
)::text) hash;
DO $$ DECLARE f record;BEGIN
 ASSERT (SELECT count(*) FROM schedule836_ctx)=2;
 FOR f IN SELECT * FROM schedule836_ctx LOOP
  ASSERT f.request_id IS NOT NULL AND f.result->>'outcome'='cancelled' AND f.result->>'count'='2';
  ASSERT (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'null')) FROM public.tournaments t)=f.tours_before;
  ASSERT (SELECT count(*) FROM public.table_operation_receipts WHERE actor_id=(f.manifest->>'actor')::uuid
   AND operation_type='create_tournament_schedule_batch_v1' AND request_id=f.request_id AND result=f.result)=1;
 END LOOP;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournaments WHERE name LIKE 'LOCAL836 schedule TEST %' OR name LIKE 'LOCAL837 schedule TEST %');
END $$;
GRANT SELECT ON schedule836_ctx TO authenticated;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record;r jsonb;BEGIN
 FOR f IN SELECT * FROM schedule836_ctx LOOP
  r:=public.get_tournament_schedule_batch_receipt_v1(f.manifest->'rows',f.request_id,(f.manifest->>'actor')::uuid);
  ASSERT r=f.result,r::text;
  -- A genuine late original writer must replay cancellation, never create tours.
  r:=public.create_tournament_schedule_batch_v1(f.manifest->'rows',f.request_id,(f.manifest->>'actor')::uuid);
  ASSERT r=f.result,r::text;
  r:=public.cancel_tournament_schedule_batch_v1(f.manifest->'rows',f.request_id,(f.manifest->>'actor')::uuid);
  ASSERT r=f.result,r::text;
  r:=public.create_tournament_schedule_batch_v1(jsonb_set(f.manifest->'rows','{0,buy_in}','100001'),f.request_id,(f.manifest->>'actor')::uuid);
  ASSERT r->>'error'='IDEMPOTENCY_CONFLICT',r::text;
 END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.table_operation_receipts r)
 )::text)=hash FROM schedule836_before);
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
ROLLBACK;
SELECT 'SCHEDULE836_837_CANCEL_TOMBSTONES_LATE_WRITER_REPLAY_CONFLICT_ZERO_TOURS_UNCHANGED_PASS';
