\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_manual_card75_overlap_20261014' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464)
 OR (SELECT count(*) FROM public.clubs)<>2
 OR NOT EXISTS(SELECT 1 FROM public.dealers WHERE id='87000000-0000-4000-8000-000000000001'
  AND user_id='81200000-0000-4000-8000-000000000001' AND status='active')
 OR md5(pg_get_functiondef('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure))<>'37faf2e637e06d255c0f9186d3a7e9e9'
 OR EXISTS(SELECT 1 FROM floor_private.tracker_manual_card_receipts_v1)
 THEN RAISE EXCEPTION 'exact_owned_manual75_overlap_fixture_required'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;
DO $test$
DECLARE before_revision bigint; first_result jsonb; busy_result jsonb; receipt_before jsonb;
 receipt_after jsonb; replay_result jsonb; conflict_result jsonb; remote_pid integer;
 payload jsonb; cards jsonb:='[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Qh","Qs"]}]';
BEGIN
 SELECT source_revision INTO STRICT before_revision FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001';
 payload:=jsonb_build_object('hand_id','86000000-0000-4000-8000-000000000001',
  'table_session_id','83500000-0000-4000-8000-000000000001','control_epoch',1,
  'expected_source_revision',before_revision,'player_hole_cards',cards);
 PERFORM public.dblink_connect('manual75_writer','host=127.0.0.1 port='||inet_server_port()
  ||' user=postgres dbname='||current_database()||' application_name=manual75_actual_writer');
 SELECT pid INTO remote_pid FROM public.dblink('manual75_writer','SELECT pg_backend_pid()') AS remote(pid integer);
 IF remote_pid=pg_backend_pid() THEN RAISE EXCEPTION 'independent_writer_backend_required'; END IF;
 PERFORM public.dblink_exec('manual75_writer','BEGIN');
 PERFORM public.dblink_exec('manual75_writer',$actor$SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub"='81200000-0000-4000-8000-000000000001';
  SET LOCAL "request.jwt.claims"='{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}'$actor$);
 SELECT result INTO first_result FROM public.dblink('manual75_writer',format($write$
  SELECT public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
   '83500000-0000-4000-8000-000000000001',1,%s,'manual75-real-overlap-0001',%L::jsonb)
 $write$,before_revision,cards::text)) AS remote(result jsonb);
 IF first_result->>'status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'canonical_remote_write_failed: %',first_result; END IF;
 -- The real writer has returned but its transaction is still open, retaining
 -- its actual receipt/hand/session locks. No sleep or mocked lock holder.
 PERFORM set_config('request.jwt.claim.sub','81200000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims','{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 busy_result:=public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',1,before_revision,'manual75-real-overlap-0001',cards);
 receipt_before:=public.get_tracker_manual_card_receipt_v1('manual75-real-overlap-0001',payload);
 RESET ROLE;
 IF busy_result->>'error' IS DISTINCT FROM 'manual_card_request_busy'
 OR receipt_before->>'status' IS DISTINCT FROM 'not_found' THEN
  RAISE EXCEPTION 'actual_uncommitted_writer_boundary_failed: %, %',busy_result,receipt_before;
 END IF;
 PERFORM public.dblink_exec('manual75_writer','COMMIT');
 -- A second connection reconciles the canonical commit using the ORIGINAL
 -- revision/key/payload. This models recovery, not an HTTP transport fault.
 SET LOCAL ROLE authenticated;
 receipt_after:=public.get_tracker_manual_card_receipt_v1('manual75-real-overlap-0001',payload);
 replay_result:=public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',1,before_revision,'manual75-real-overlap-0001',cards);
 conflict_result:=public.show_tracker_manual_cards_v1('86000000-0000-4000-8000-000000000001',
  '83500000-0000-4000-8000-000000000001',1,before_revision,'manual75-real-overlap-0001',
  '[{"player_id":"82000000-0000-4000-8000-000000000002","entry_number":1,"hole_cards":["Jh","Js"]}]');
 RESET ROLE;
 IF receipt_after->>'status' IS DISTINCT FROM 'committed' OR replay_result IS DISTINCT FROM first_result
 OR conflict_result->>'error' IS DISTINCT FROM 'idempotency_conflict'
 OR (receipt_after->>'expected_source_revision')::bigint IS DISTINCT FROM before_revision
 OR (receipt_after->>'committed_source_revision')::bigint IS DISTINCT FROM (first_result->>'committed_source_revision')::bigint
 OR (SELECT source_revision FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM (first_result->>'committed_source_revision')::bigint
 OR (SELECT count(*) FROM floor_private.tracker_manual_card_receipts_v1)<>1
 OR NOT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001'
  AND player_id='82000000-0000-4000-8000-000000000002' AND hole_cards='["Qh","Qs"]'::jsonb)
 THEN RAISE EXCEPTION 'committed_receipt_replay_zero_additional_mutation_failed'; END IF;
 PERFORM public.dblink_disconnect('manual75_writer');
END $test$;
COMMIT;
\echo MANUAL75_TRUE_BACKEND_COMMIT_RECEIPT_REPLAY_CONFLICT_PASS
