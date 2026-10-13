-- Actual two-session overlap, adapted from existing dblink/lock-barrier suites.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_voice_overlap_20261014','vinpoker_voice_release71_overlap_20261014') OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres' THEN RAISE EXCEPTION 'owned_overlap_db_required'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
DO $overlap$
DECLARE
 root_id uuid;
 first_pid integer;
 second_pid integer;
 deadline timestamptz;
 result jsonb;
BEGIN
 SELECT id INTO STRICT root_id FROM public.tracker_voice_events WHERE event_kind='final_transcript';
 PERFORM public.dblink_connect('voice_handoff_first','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice_handoff_first');
 PERFORM public.dblink_connect('voice_handoff_second','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice_handoff_second');
 SELECT pid INTO first_pid FROM public.dblink('voice_handoff_first','SELECT pg_backend_pid()') AS r(pid integer);
 SELECT pid INTO second_pid FROM public.dblink('voice_handoff_second','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('voice_handoff_first','BEGIN; SET LOCAL statement_timeout=''8s'';');
 PERFORM public.dblink_exec('voice_handoff_first',$sql$
  UPDATE public.dealer_assignments SET status='completed',released_at=now() WHERE id='88000000-0000-4000-8000-000000000001';
  INSERT INTO public.dealer_assignments(id,dealer_id,attendance_id,table_id,table_session_id,club_id,assigned_at,status) VALUES('88000000-0000-4000-8000-000000000010','87000000-0000-4000-8000-000000000003','87500000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',now(),'assigned');
 $sql$);
 PERFORM public.dblink_exec('voice_handoff_second','SET statement_timeout=''8s''; SET ROLE authenticated;');
 PERFORM public.dblink_exec('voice_handoff_second',$sql$
  DO $$ BEGIN
   PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
   PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
  END $$;
 $sql$);
 PERFORM public.dblink_send_query('voice_handoff_second',format('SELECT public.commit_tracker_voice_board_v0(%L::uuid,''voice-board-flop-0001'',''trace-real-overlap'')::text',root_id));
 deadline:=clock_timestamp()+interval '5 seconds';
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=second_pid AND wait_event_type='Lock' AND first_pid=ANY(pg_blocking_pids(second_pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'actual_overlap_barrier_absent'; END IF;
  PERFORM pg_sleep(0.025);
 END LOOP;
 RAISE NOTICE 'ACTUAL_LOCK_OVERLAP_OBSERVED';
 PERFORM public.dblink_exec('voice_handoff_first','COMMIT');
 SELECT payload::jsonb INTO STRICT result FROM public.dblink_get_result('voice_handoff_second') AS r(payload text);
 IF result->>'error' IS DISTINCT FROM 'voice_assignment_changed'
 OR EXISTS(SELECT 1 FROM public.tracker_voice_events WHERE root_event_id=root_id)
 OR (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '[]'::jsonb THEN
  RAISE EXCEPTION 'handoff_overlap_zero_write_failed: %',result;
 END IF;
 PERFORM public.dblink_disconnect('voice_handoff_first');
 PERFORM public.dblink_disconnect('voice_handoff_second');
 RAISE NOTICE 'VOICE_HANDOFF_ACTUAL_OVERLAP_ZERO_WRITE_PASS';
EXCEPTION WHEN OTHERS THEN
 IF 'voice_handoff_first'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN
  PERFORM public.dblink_exec('voice_handoff_first','ROLLBACK');
  PERFORM public.dblink_disconnect('voice_handoff_first');
 END IF;
 IF 'voice_handoff_second'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN
  PERFORM public.dblink_disconnect('voice_handoff_second');
 END IF;
 RAISE;
END;
$overlap$;
