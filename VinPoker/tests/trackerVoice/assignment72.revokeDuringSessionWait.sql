-- Three actual connections: session holder, authenticated Voice, role revoker.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_voice_assignment72_authority_overlap_20261014','vinpoker_voice_assignment72_authority_red_20261014')
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>(CASE WHEN current_database()='vinpoker_voice_assignment72_authority_red_20261014' THEN '96ba904dfcdfaa23dba36b6862aba168' ELSE '0a9e1f4e0972015b1554d6cd10f5ee2a' END) THEN RAISE EXCEPTION 'owned_assignment72_overlap_required'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
DO $overlap$
DECLARE root_id uuid; holder_pid integer; voice_pid integer; deadline timestamptz; result jsonb; connection_name text;
BEGIN
 SELECT id INTO STRICT root_id FROM public.tracker_voice_events WHERE event_kind='final_transcript';
 FOREACH connection_name IN ARRAY ARRAY['voice72_session_holder','voice72_waiting_actor','voice72_role_revoker'] LOOP
  PERFORM public.dblink_connect(connection_name,'host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name='||connection_name);
 END LOOP;
 SELECT pid INTO holder_pid FROM public.dblink('voice72_session_holder','SELECT pg_backend_pid()') AS r(pid integer);
 SELECT pid INTO voice_pid FROM public.dblink('voice72_waiting_actor','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('voice72_session_holder',$sql$BEGIN; SET LOCAL statement_timeout='8s'; DO $$ BEGIN PERFORM 1 FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001' FOR UPDATE; END $$;$sql$);
 PERFORM public.dblink_exec('voice72_waiting_actor',$sql$
  SET statement_timeout='8s'; SET ROLE authenticated;
  DO $$ BEGIN
   PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
   PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
  END $$;
 $sql$);
 PERFORM public.dblink_send_query('voice72_waiting_actor',$sql$SELECT public.get_tracker_voice_runtime_context('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001')::text$sql$);
 deadline:=clock_timestamp()+interval '5 seconds';
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=voice_pid AND wait_event_type='Lock' AND holder_pid=ANY(pg_blocking_pids(voice_pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'voice72_actual_session_wait_missing'; END IF;
  PERFORM pg_sleep(0.025);
 END LOOP;
 -- Separate connection commits the revocation while Voice is visibly blocked.
 IF public.dblink_exec('voice72_role_revoker',$sql$DELETE FROM public.club_floors WHERE club_id='81000000-0000-4000-8000-000000000001' AND user_id='81300000-0000-4000-8000-000000000001'$sql$)<>'DELETE 1' THEN RAISE EXCEPTION 'voice72_exact_revocation_missing'; END IF;
 PERFORM public.dblink_exec('voice72_session_holder','COMMIT');
 SELECT payload::jsonb INTO STRICT result FROM public.dblink_get_result('voice72_waiting_actor') AS r(payload text);
 IF result->>'error' IS DISTINCT FROM 'dealer_assignment_missing'
 OR EXISTS(SELECT 1 FROM public.tracker_voice_events WHERE root_event_id=root_id)
 OR (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '[]'::jsonb THEN
  RAISE EXCEPTION 'VOICE72_REVOKE_DURING_SESSION_WAIT_EXPECTED_DENIAL: %',result;
 END IF;
 PERFORM public.dblink_exec('voice72_role_revoker',$sql$INSERT INTO public.club_floors(club_id,user_id) VALUES('81000000-0000-4000-8000-000000000001','81300000-0000-4000-8000-000000000001')$sql$);
 FOREACH connection_name IN ARRAY ARRAY['voice72_session_holder','voice72_waiting_actor','voice72_role_revoker'] LOOP PERFORM public.dblink_disconnect(connection_name); END LOOP;
 RAISE NOTICE 'VOICE72_REVOKE_DURING_ACTUAL_SESSION_WAIT_ZERO_WRITE_PASS';
EXCEPTION WHEN OTHERS THEN
 IF 'voice72_session_holder'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_exec('voice72_session_holder','ROLLBACK'); END IF;
 FOREACH connection_name IN ARRAY ARRAY['voice72_session_holder','voice72_waiting_actor','voice72_role_revoker'] LOOP
  IF connection_name=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_disconnect(connection_name); END IF;
 END LOOP;
 RAISE;
END;
$overlap$;
