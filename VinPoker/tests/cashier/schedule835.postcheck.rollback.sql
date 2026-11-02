\set ON_ERROR_STOP on
DO $$ BEGIN
 ASSERT current_database()='vinpoker_checkout814_race_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
CREATE TEMP TABLE schedule835_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.table_operation_receipts r)
)::text) hash;
BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';
DO $$ DECLARE f record;r jsonb;BEGIN
 SELECT * INTO STRICT f FROM private.schedule835_fixture WHERE id;
 ASSERT f.request_id='e857551b-bc9a-4bc2-bcd2-241fd8e9f94f' AND f.result->>'ok'='true' AND f.result->>'count'='2';
 ASSERT (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'null')) FROM public.tournaments t
  WHERE id NOT IN(SELECT (child->>'tournament_id')::uuid FROM jsonb_array_elements(f.result->'tournaments') child))=f.tours_before;
 FOR r IN SELECT * FROM jsonb_array_elements(f.manifest->'rows') LOOP
  ASSERT (SELECT count(*) FROM public.tournaments t WHERE t.club_id=(r->>'club_id')::uuid AND t.name=r->>'name'
   AND t.start_time=(r->>'start_time')::timestamptz AND t.buy_in=(r->>'buy_in')::numeric AND t.starting_stack=(r->>'starting_stack')::numeric
   AND t.game_type=r->>'game_type' AND t.live_status='registering' AND t.clock_started_at IS NULL)=1;
 END LOOP;
 ASSERT (SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND operation_type='create_tournament_schedule_batch_v1' AND request_id=f.request_id AND result=f.result)=1;
 PERFORM set_config('schedule835.rows',(f.manifest->'rows')::text,true);
 PERFORM set_config('schedule835.result',f.result::text,true);
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE rows jsonb:=current_setting('schedule835.rows')::jsonb;saved jsonb:=current_setting('schedule835.result')::jsonb;
 request uuid:='e857551b-bc9a-4bc2-bcd2-241fd8e9f94f';actor uuid:='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
 result jsonb;child jsonb;tour uuid;before_row jsonb;after_row jsonb;
BEGIN
 result:=public.get_tournament_schedule_batch_receipt_v1(rows,request,actor);ASSERT result=saved,result::text;
 result:=public.create_tournament_schedule_batch_v1(rows,request,actor);ASSERT result=saved,result::text;
 result:=public.cancel_tournament_schedule_batch_v1(rows,request,actor);ASSERT result=saved,'cancellation is not deletion or undo';
 result:=public.create_tournament_schedule_batch_v1(jsonb_set(rows,'{0,buy_in}','100001'),request,actor);
 ASSERT result->>'error'='IDEMPOTENCY_CONFLICT',result::text;
 FOR child IN SELECT * FROM jsonb_array_elements(saved->'tournaments') LOOP
  tour:=(child->>'tournament_id')::uuid;
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_levels WHERE tournament_id=tour);
  SELECT to_jsonb(t) INTO STRICT before_row FROM public.tournaments t WHERE id=tour;
  result:=public.floor_start_tournament_clock(tour);
  ASSERT result->>'ok'='false' AND result->>'error' IN('no_tournament_level','invalid_tournament_level'),result::text;
  SELECT to_jsonb(t) INTO STRICT after_row FROM public.tournaments t WHERE id=tour;
  ASSERT after_row=before_row,'missing levels must deny clock with no tournament delta';
 END LOOP;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t),
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.table_operation_receipts r)
 )::text)=hash FROM schedule835_before);
END $$;
ROLLBACK;
SELECT 'SCHEDULE835_TWO_ROWS_ONE_BATCH_RECEIPT_REPLAY_CANCEL_CONFLICT_CLOCK_GUARD_NO_DELTA_PASS';
