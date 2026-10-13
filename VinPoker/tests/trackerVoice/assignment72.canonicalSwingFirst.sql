-- Actual public Owner Swing holds its transaction while Floor Voice waits.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_voice_assignment72_authority_overlap_20261014','vinpoker_voice_swing73_swing_first_20261014','vinpoker_voice_swing73_swing_first_qualified_20261014')
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port() NOT IN (55441,55464) OR current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'0a9e1f4e0972015b1554d6cd10f5ee2a'
 OR md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>(CASE WHEN current_database()='vinpoker_voice_assignment72_authority_overlap_20261014' THEN '3f3e35df593064562056326969364bac' ELSE 'a25a91e02d6f2c0399e5aba1086e4acf' END)
 OR md5(replace(pg_get_functiondef('public._dealer_swing_assert_exact_context(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'f7532f6f5dfb3556a8e7ad71e494a640'
 OR md5(replace(pg_get_functiondef('public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure),chr(13),''))<>'8c47fa4e511eb3d5d622667fce71b134' THEN RAISE EXCEPTION 'owned_canonical_swing72_required'; END IF;
 IF current_database() LIKE 'vinpoker_voice_swing73_%' AND (
 md5(replace(pg_get_functiondef('floor_private.resolve_table_mode_request_v1(uuid)'::regprocedure),chr(13),''))<>'a19c384b03b7f3256af25985125f1841'
 OR md5(replace(pg_get_functiondef('floor_private.table_mode_boundary_v1()'::regprocedure),chr(13),''))<>'133a7d13ae6eb9edd856c107f606a0b8'
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass AND tgfoid='floor_private.table_mode_boundary_v1()'::regprocedure AND tgname='trg_mode_after_hand_v1' AND tgenabled='O' AND tgdeferrable AND tginitdeferred)
 ) THEN RAISE EXCEPTION 'qualified_deferred_mode_dependency_required'; END IF;
END $$;
-- Qualified synthetic preassignment, not a production repair/rest override.
UPDATE public.game_tables SET table_number=1,operational_status='available' WHERE id='83000000-0000-4000-8000-000000000001';
UPDATE public.dealers SET user_id=NULL WHERE id='87000000-0000-4000-8000-000000000003';
UPDATE public.dealer_assignments SET pre_assigned_attendance_id='87500000-0000-4000-8000-000000000003' WHERE id='88000000-0000-4000-8000-000000000001';
UPDATE public.dealer_attendance SET pre_assigned_table_id='83000000-0000-4000-8000-000000000001',pre_assigned_at=now() WHERE id='87500000-0000-4000-8000-000000000003';
CREATE EXTENSION IF NOT EXISTS dblink;
DO $overlap$
DECLARE root_id uuid; swing_pid integer; voice_pid integer; deadline timestamptz; swing_result jsonb; voice_result jsonb;
BEGIN
 SELECT id INTO STRICT root_id FROM public.tracker_voice_events WHERE event_kind='final_transcript';
 PERFORM public.dblink_connect('voice72_canonical_swing','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice72_canonical_swing');
 PERFORM public.dblink_connect('voice72_canonical_voice','host=127.0.0.1 port='||inet_server_port()||' user=postgres dbname='||current_database()||' application_name=voice72_canonical_voice');
 SELECT pid INTO swing_pid FROM public.dblink('voice72_canonical_swing','SELECT pg_backend_pid()') AS r(pid integer);
 SELECT pid INTO voice_pid FROM public.dblink('voice72_canonical_voice','SELECT pg_backend_pid()') AS r(pid integer);
 PERFORM public.dblink_exec('voice72_canonical_swing',$sql$
 BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL ROLE authenticated;
 DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claims','{"sub":"81100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 END $$;
 $sql$);
 SELECT payload::jsonb INTO STRICT swing_result FROM public.dblink('voice72_canonical_swing',$sql$SELECT public.operator_perform_swing('83000000-0000-4000-8000-000000000001','83500000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001',(SELECT version FROM public.dealer_assignments WHERE id='88000000-0000-4000-8000-000000000001'),'89000000-0000-4000-8000-000000000072')::text$sql$) AS r(payload text);
 IF swing_result->>'outcome' IS DISTINCT FROM 'swung' OR swing_result->>'new_assignment_id' IS NULL THEN RAISE EXCEPTION 'canonical_swing_not_executed: %',swing_result; END IF;
 PERFORM public.dblink_exec('voice72_canonical_voice',$sql$
 SET statement_timeout='8s'; SET ROLE authenticated;
 DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub','81300000-0000-4000-8000-000000000001',false);
  PERFORM set_config('request.jwt.claims','{"sub":"81300000-0000-4000-8000-000000000001","role":"authenticated"}',false);
 END $$;
 $sql$);
 PERFORM public.dblink_send_query('voice72_canonical_voice',format('SELECT public.commit_tracker_voice_board_v0(%L::uuid,''voice-board-flop-0001'',''trace72-swing-first'')::text',root_id));
 deadline:=clock_timestamp()+interval '5 seconds';
 LOOP
  PERFORM pg_stat_clear_snapshot();
  EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=voice_pid AND wait_event_type='Lock' AND swing_pid=ANY(pg_blocking_pids(voice_pid)));
  IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'canonical_swing_voice_overlap_missing'; END IF;
  PERFORM pg_sleep(0.025);
 END LOOP;
 PERFORM public.dblink_exec('voice72_canonical_swing','COMMIT');
 SELECT payload::jsonb INTO STRICT voice_result FROM public.dblink_get_result('voice72_canonical_voice') AS r(payload text);
 IF voice_result->>'error' IS DISTINCT FROM 'voice_assignment_changed'
 OR EXISTS(SELECT 1 FROM public.tracker_voice_events WHERE root_event_id=root_id)
 OR (SELECT community_cards FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001') IS DISTINCT FROM '[]'::jsonb
 OR (SELECT count(*) FROM public.dealer_assignments WHERE table_id='83000000-0000-4000-8000-000000000001' AND status='assigned' AND released_at IS NULL)<>1
 OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=(swing_result->>'new_assignment_id')::uuid AND dealer_id='87000000-0000-4000-8000-000000000003' AND table_session_id='83500000-0000-4000-8000-000000000001' AND status='assigned') THEN
  RAISE EXCEPTION 'canonical_swing_first_receipt_or_zero_write_failed: %',voice_result;
 END IF;
 PERFORM public.dblink_disconnect('voice72_canonical_swing'); PERFORM public.dblink_disconnect('voice72_canonical_voice');
 RAISE NOTICE 'VOICE72_CANONICAL_SWING_FIRST_ACTUAL_OVERLAP_ZERO_WRITE_PASS';
EXCEPTION WHEN OTHERS THEN
 IF 'voice72_canonical_swing'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_exec('voice72_canonical_swing','ROLLBACK'); PERFORM public.dblink_disconnect('voice72_canonical_swing'); END IF;
 IF 'voice72_canonical_voice'=ANY(COALESCE(public.dblink_get_connections(),ARRAY[]::text[])) THEN PERFORM public.dblink_disconnect('voice72_canonical_voice'); END IF;
 RAISE;
END;
$overlap$;
