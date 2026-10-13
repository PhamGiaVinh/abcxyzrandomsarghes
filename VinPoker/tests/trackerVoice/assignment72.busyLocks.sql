-- Actual simultaneous transactions; NOWAIT must reject before any card receipt.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'vinpoker_voice_assignment72_authority_overlap_20261014'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'0a9e1f4e0972015b1554d6cd10f5ee2a' THEN RAISE EXCEPTION 'owned_assignment72_busy_fixture_required'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
DO $busy$
DECLARE item record; root_id uuid; holder_pid integer; result jsonb;
BEGIN
 SELECT id INTO STRICT root_id FROM public.tracker_voice_events WHERE event_kind='final_transcript';
 PERFORM public.dblink_connect('voice72_busy_holder','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice72_busy_holder');
 PERFORM public.dblink_connect('voice72_busy_actor','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice72_busy_actor');
 SELECT pid INTO holder_pid FROM public.dblink('voice72_busy_holder','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('voice72_busy_actor',$sql$
 SET statement_timeout='3s'; SET ROLE authenticated;
 DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
  PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
 END $$;
 $sql$);
 FOR item IN SELECT * FROM (VALUES
  ('dealer_assignments','88000000-0000-4000-8000-000000000001'),
  ('dealers','87000000-0000-4000-8000-000000000001'),
  ('dealer_attendance','87500000-0000-4000-8000-000000000001')) AS rows(relation,id) LOOP
  PERFORM public.dblink_exec('voice72_busy_holder','BEGIN; SET LOCAL statement_timeout=''8s'';');
  PERFORM public.dblink_exec('voice72_busy_holder',format('DO $$ BEGIN PERFORM 1 FROM public.%I WHERE id=%L::uuid FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION ''exact_busy_row_missing''; END IF; END $$;',item.relation,item.id));
  PERFORM pg_stat_clear_snapshot();
  IF NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=holder_pid AND state='idle in transaction' AND backend_xid IS NOT NULL) THEN RAISE EXCEPTION 'actual_busy_holder_not_observed'; END IF;
  SELECT payload::jsonb INTO STRICT result FROM public.dblink('voice72_busy_actor',format('SELECT public.commit_tracker_voice_board_v0(%L::uuid,''voice-board-flop-0001'',''trace72-busy'')::text',root_id)) AS r(payload text);
  IF result->>'error' IS DISTINCT FROM 'dealer_assignment_busy'
  OR EXISTS(SELECT 1 FROM public.tracker_voice_events WHERE root_event_id=root_id)
  OR (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '[]'::jsonb THEN
   RAISE EXCEPTION 'VOICE72_BUSY_LOCK_ZERO_WRITE_REQUIRED %: %',item.relation,result;
  END IF;
  PERFORM public.dblink_exec('voice72_busy_holder','ROLLBACK');
  RAISE NOTICE 'VOICE72_ACTUAL_BUSY_%_ZERO_WRITE_PASS',item.relation;
 END LOOP;
 PERFORM public.dblink_disconnect('voice72_busy_holder');
 PERFORM public.dblink_disconnect('voice72_busy_actor');
EXCEPTION WHEN OTHERS THEN
 IF 'voice72_busy_holder'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_exec('voice72_busy_holder','ROLLBACK'); PERFORM public.dblink_disconnect('voice72_busy_holder'); END IF;
 IF 'voice72_busy_actor'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_disconnect('voice72_busy_actor'); END IF;
 RAISE;
END;
$busy$;
