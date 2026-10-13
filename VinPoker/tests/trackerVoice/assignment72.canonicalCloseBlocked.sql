-- Occupied active-hand table: public Floor close must refuse and preserve Voice.
-- Actual overlap, not proof that an empty table closes or an Edge checkout runs.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'vinpoker_voice_assignment72_close_first_20261014'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'0a9e1f4e0972015b1554d6cd10f5ee2a'
 OR md5(replace(pg_get_functiondef('public.close_tournament_table_v4(uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'1d9295e2da7c50daddfea9552e297a7e'
 OR md5(replace(pg_get_functiondef('public.close_tournament_table_v3(uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'1fdcf509235a612c85ad3dfcff4c68e8' THEN RAISE EXCEPTION 'owned_canonical_close72_required'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
DO $overlap$
DECLARE root_id uuid; closer_pid integer; voice_pid integer; deadline timestamptz; result jsonb; expected_revision bigint;
BEGIN
 SELECT id INTO STRICT root_id FROM public.tracker_voice_events WHERE event_kind='final_transcript';
 SELECT revision INTO STRICT expected_revision FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001';
 PERFORM public.dblink_connect('voice72_close','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database());
 PERFORM public.dblink_connect('voice72_after_close','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database());
 SELECT pid INTO closer_pid FROM public.dblink('voice72_close','SELECT pg_backend_pid()') AS r(pid integer);
 SELECT pid INTO voice_pid FROM public.dblink('voice72_after_close','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('voice72_close',$sql$BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL ROLE authenticated;
 DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 END $$;$sql$);
 SELECT payload::jsonb INTO STRICT result FROM public.dblink('voice72_close',format('SELECT public.close_tournament_table_v4(''84000000-0000-4000-8000-000000000001'',%s,''89000000-0000-4000-8000-000000000073'')::text',expected_revision)) AS r(payload text);
 IF result->>'error' IS DISTINCT FROM 'table_not_empty' THEN RAISE EXCEPTION 'occupied_close_not_denied: %',result; END IF;
 PERFORM public.dblink_exec('voice72_after_close',$sql$SET statement_timeout='8s'; SET ROLE authenticated;
 DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
  PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
 END $$;$sql$);
 PERFORM public.dblink_send_query('voice72_after_close',format('SELECT public.commit_tracker_voice_board_v0(%L::uuid,''voice-board-flop-0001'',''trace72-close-denied'')::text',root_id));
 deadline:=clock_timestamp()+interval '5 seconds';
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=voice_pid AND wait_event_type='Lock' AND closer_pid=ANY(pg_blocking_pids(voice_pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'canonical_close_voice_overlap_missing'; END IF;
  PERFORM pg_sleep(0.025);
 END LOOP;
 PERFORM public.dblink_exec('voice72_close','COMMIT');
 SELECT payload::jsonb INTO STRICT result FROM public.dblink_get_result('voice72_after_close') AS r(payload text);
 IF result->>'ok' IS DISTINCT FROM 'true'
 OR (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '["Ah","5s","2d"]'::jsonb
 OR (SELECT count(*) FROM public.tracker_voice_events WHERE root_event_id=root_id AND event_kind='canonical_receipt')<>1
 OR NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001' AND closed_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='88000000-0000-4000-8000-000000000001' AND released_at IS NULL AND status='assigned')
 OR EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='89000000-0000-4000-8000-000000000073') THEN RAISE EXCEPTION 'canonical_close_denial_or_voice_failed: %',result; END IF;
 PERFORM public.dblink_disconnect('voice72_close'); PERFORM public.dblink_disconnect('voice72_after_close');
 RAISE NOTICE 'VOICE72_OCCUPIED_CLOSE_DENIAL_ACTUAL_OVERLAP_VOICE_PASS';
EXCEPTION WHEN OTHERS THEN
 IF 'voice72_close'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_exec('voice72_close','ROLLBACK'); PERFORM public.dblink_disconnect('voice72_close'); END IF;
 IF 'voice72_after_close'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_disconnect('voice72_after_close'); END IF;
 RAISE;
END;
$overlap$;
