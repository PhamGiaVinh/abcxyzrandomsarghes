-- Actual holder/actor/revoker connections; permissions revoked during observed wait.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'vinpoker_voice_swing73_voice_first_qualified_20261014'
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf'
 OR EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE club_id='81000000-0000-4000-8000-000000000001' AND user_id='81100000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'owned73_owner_revocation_fixture_required'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
DO $test$
DECLARE holder_pid integer; actor_pid integer; deadline timestamptz; rejected boolean:=false; payload text; conn text; assignment_id uuid; expected_version integer;
BEGIN
 SELECT id,version INTO STRICT assignment_id,expected_version FROM public.dealer_assignments WHERE table_id='83000000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL;
 IF NOT public.is_club_dealer_control('81100000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'owner_authority_initially_missing'; END IF;
 FOREACH conn IN ARRAY ARRAY['swing73_holder','swing73_actor','swing73_revoker'] LOOP
  PERFORM public.dblink_connect(conn,'host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database());
 END LOOP;
 SELECT pid INTO holder_pid FROM public.dblink('swing73_holder','SELECT pg_backend_pid()') AS r(pid integer);
 SELECT pid INTO actor_pid FROM public.dblink('swing73_actor','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('swing73_holder',$sql$BEGIN; SET LOCAL statement_timeout='8s'; DO $$ BEGIN PERFORM 1 FROM public.game_tables WHERE id='83000000-0000-4000-8000-000000000001' FOR UPDATE; END $$;$sql$);
 PERFORM public.dblink_exec('swing73_actor',$sql$SET statement_timeout='8s'; SET ROLE authenticated; DO $$ BEGIN
 PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',false);
 PERFORM set_config('request.jwt.claims','{"sub":"81100000-0000-4000-8000-000000000001","role":"authenticated"}',false); END $$;$sql$);
 PERFORM public.dblink_send_query('swing73_actor',format('SELECT public.operator_perform_swing(''83000000-0000-4000-8000-000000000001'',''83500000-0000-4000-8000-000000000001'',%L::uuid,%s,''89000000-0000-4000-8000-000000000076'')::text',assignment_id,expected_version));
 deadline:=clock_timestamp()+interval '5 seconds';
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=actor_pid AND wait_event_type='Lock' AND holder_pid=ANY(pg_blocking_pids(actor_pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'swing73_actual_physical_wait_missing'; END IF;
  PERFORM pg_sleep(0.025);
 END LOOP;
 IF public.dblink_exec('swing73_revoker',$sql$UPDATE public.clubs SET owner_id=NULL WHERE id='81000000-0000-4000-8000-000000000001' AND owner_id='81100000-0000-4000-8000-000000000001'$sql$)<>'UPDATE 1' THEN RAISE EXCEPTION 'exact_owner_revocation_missing'; END IF;
 PERFORM public.dblink_exec('swing73_holder','COMMIT');
 BEGIN
  SELECT result INTO payload FROM public.dblink_get_result('swing73_actor') AS r(result text);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SWING_OPERATOR_FORBIDDEN' THEN RAISE; END IF; rejected:=true; END;
 IF NOT rejected OR EXISTS(SELECT 1 FROM public.dealer_swing_operator_requests WHERE request_id='89000000-0000-4000-8000-000000000076')
 OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=assignment_id AND version=expected_version AND released_at IS NULL AND status='assigned') THEN RAISE EXCEPTION 'revoked_swing_actor_wrote_state'; END IF;
 PERFORM public.dblink_exec('swing73_revoker',$sql$UPDATE public.clubs SET owner_id='81100000-0000-4000-8000-000000000001' WHERE id='81000000-0000-4000-8000-000000000001' AND owner_id IS NULL$sql$);
 FOREACH conn IN ARRAY ARRAY['swing73_holder','swing73_actor','swing73_revoker'] LOOP PERFORM public.dblink_disconnect(conn); END LOOP;
 RAISE NOTICE 'SWING73_REVOKED_DURING_PHYSICAL_WAIT_ZERO_WRITE_PASS';
EXCEPTION WHEN OTHERS THEN
 IF 'swing73_holder'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_exec('swing73_holder','ROLLBACK'); END IF;
 FOREACH conn IN ARRAY ARRAY['swing73_holder','swing73_actor','swing73_revoker'] LOOP IF conn=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_disconnect(conn); END IF; END LOOP;
 RAISE;
END;
$test$;
