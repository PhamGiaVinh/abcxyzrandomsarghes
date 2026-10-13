-- Reverse real overlap on owned synthetic clone, not canonical Swing UAT.
\set ON_ERROR_STOP on
DO $overlap$
DECLARE root_id uuid; first_pid integer; second_pid integer; deadline timestamptz; result jsonb; new_assignment text;
BEGIN
 IF current_database() NOT IN ('vinpoker_voice_overlap_20261014','vinpoker_voice_release71_overlap_20261014') OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres' THEN RAISE EXCEPTION 'owned_overlap_db_required'; END IF;
 SELECT id INTO STRICT root_id FROM public.tracker_voice_events WHERE event_kind='final_transcript' AND idempotency_key='voice-board-reverse-0001';
 PERFORM public.dblink_connect('voice_first','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice_first');
 PERFORM public.dblink_connect('handoff_second','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=handoff_second');
 SELECT pid INTO first_pid FROM public.dblink('voice_first','SELECT pg_backend_pid()') AS r(pid integer);
 SELECT pid INTO second_pid FROM public.dblink('handoff_second','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('voice_first','BEGIN; SET LOCAL statement_timeout=''8s''; SET ROLE authenticated;');
 PERFORM public.dblink_exec('voice_first',$sql$
  DO $$ BEGIN
   PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
   PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
  END $$;
 $sql$);
 SELECT payload::jsonb INTO STRICT result FROM public.dblink('voice_first',format('SELECT public.commit_tracker_voice_board_v0(%L::uuid,''voice-board-reverse-0001'',''trace-voice-first'')::text',root_id)) AS r(payload text);
 IF COALESCE((result->>'ok')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'voice_first_commit_failed: %',result; END IF;
 PERFORM public.dblink_exec('handoff_second','SET statement_timeout=''8s'';');
 PERFORM public.dblink_send_query('handoff_second',$sql$
  WITH completed AS (
   UPDATE public.dealer_assignments SET status='completed',released_at=now()
   WHERE id='88000000-0000-4000-8000-000000000010' AND status='assigned'
   RETURNING table_id,table_session_id,club_id)
  INSERT INTO public.dealer_assignments(id,dealer_id,attendance_id,table_id,table_session_id,club_id,assigned_at,status)
  SELECT '88000000-0000-4000-8000-000000000011','87000000-0000-4000-8000-000000000001','87500000-0000-4000-8000-000000000001',table_id,table_session_id,club_id,now(),'assigned' FROM completed RETURNING id::text;
 $sql$);
 deadline:=clock_timestamp()+interval '5 seconds';
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=second_pid AND wait_event_type='Lock' AND first_pid=ANY(pg_blocking_pids(second_pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'reverse_overlap_barrier_absent'; END IF;
  PERFORM pg_sleep(0.025);
 END LOOP;
 RAISE NOTICE 'REVERSE_ACTUAL_LOCK_OVERLAP_OBSERVED';
 PERFORM public.dblink_exec('voice_first','COMMIT');
 SELECT payload INTO STRICT new_assignment FROM public.dblink_get_result('handoff_second') AS r(payload text);
 IF new_assignment<>'88000000-0000-4000-8000-000000000011'
 OR (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '["Ah","5s","2d"]'::jsonb
 OR (SELECT count(*) FROM public.tracker_voice_events WHERE root_event_id=root_id AND event_kind='canonical_receipt' AND assignment_id='88000000-0000-4000-8000-000000000010' AND dealer_id='87000000-0000-4000-8000-000000000003')<>1
 OR (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='83500000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL)<>1 THEN
  RAISE EXCEPTION 'reverse_overlap_postcondition_failed';
 END IF;
 PERFORM public.dblink_disconnect('voice_first');
 PERFORM public.dblink_disconnect('handoff_second');
 RAISE NOTICE 'VOICE_FIRST_ACTUAL_OVERLAP_CANONICAL_RECEIPT_PASS';
EXCEPTION WHEN OTHERS THEN
 IF 'voice_first'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN
  PERFORM public.dblink_exec('voice_first','ROLLBACK'); PERFORM public.dblink_disconnect('voice_first');
 END IF;
 IF 'handoff_second'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_disconnect('handoff_second'); END IF;
 RAISE;
END;
$overlap$;
