\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('vinpoker_ops_initial102_ci','vinpoker_ops_initial102_qualified')
 OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55441 OR current_user<>'postgres' THEN
  RAISE EXCEPTION 'owned_initial102_ready_selection_fixture_required';
 END IF;
END $$;
DO $$ DECLARE current_row public.dealer_assignments%ROWTYPE; historical_id uuid:=gen_random_uuid(); old_pick uuid; fixed_pick uuid; inventory_ok boolean;
 history_table uuid; history_session uuid; historical_attendance uuid; historical_dealer uuid; new_session uuid:=gen_random_uuid();
BEGIN
 SELECT a.* INTO STRICT current_row FROM public.dealer_assignments a JOIN public.game_tables g ON g.id=a.table_id
 WHERE g.table_name='Initial102 TEST 1' AND a.status='assigned' AND a.released_at IS NULL;
 UPDATE public.dealer_assignments SET swing_due_at=now()-interval '1 minute' WHERE id=current_row.id;
 SELECT g.id,s.id,d.id,dat.id INTO STRICT history_table,history_session,historical_dealer,historical_attendance
 FROM public.game_tables g JOIN public.table_sessions s ON s.game_table_id=g.id
 JOIN public.dealers d ON d.club_id=g.club_id AND d.full_name='Initial102 TEST 2'
 JOIN public.dealer_attendance dat ON dat.dealer_id=d.id
 WHERE g.table_name='Initial102 TEST 2' AND s.closed_at IS NOT NULL;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
 VALUES(new_session,current_row.club_id,history_table,'cash','manual',1,1,'e1800000-0000-4000-8000-000000000001');
 -- Explicit malformed legacy history fixture, allowed by the actual schema.
 -- No operational writer is claimed to create this inconsistent historical row.
 INSERT INTO public.dealer_assignments
 SELECT (jsonb_populate_record(NULL::public.dealer_assignments,to_jsonb(a)||jsonb_build_object(
  'id',historical_id,'table_id',history_table,'table_session_id',history_session,'attendance_id',historical_attendance,'dealer_id',historical_dealer,
  'idempotency_key',NULL,'released_at',now()-interval '2 minutes','swing_due_at',now()-interval '10 minutes'))).*
 FROM public.dealer_assignments a WHERE a.id=current_row.id;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 SET LOCAL ROLE service_role;
 SELECT EXISTS(SELECT 1 FROM public.get_dealer_operational_tables_v1(current_row.club_id) i
  WHERE i.id=current_row.table_id AND i.table_session_id=current_row.table_session_id)
  AND EXISTS(SELECT 1 FROM public.get_dealer_operational_tables_v1(current_row.club_id) i WHERE i.id=history_table AND i.table_session_id=new_session) INTO inventory_ok;
 RESET ROLE;
 IF inventory_ok IS NOT TRUE THEN RAISE EXCEPTION 'history_fixture_not_operational_inventory_valid'; END IF;
 SELECT a.id INTO old_pick FROM public.dealer_assignments a WHERE a.club_id=current_row.club_id
  AND a.table_id IN (current_row.table_id,history_table) AND a.status='assigned' AND a.swing_due_at<now() ORDER BY a.swing_due_at LIMIT 1;
 SELECT a.id INTO fixed_pick FROM public.dealer_assignments a WHERE a.club_id=current_row.club_id
  AND a.table_id IN (current_row.table_id,history_table) AND a.status='assigned' AND a.released_at IS NULL
  AND a.swing_due_at<now() ORDER BY a.swing_due_at LIMIT 1;
 IF old_pick IS DISTINCT FROM historical_id OR fixed_pick IS DISTINCT FROM current_row.id THEN
  RAISE EXCEPTION 'released_history_selection_not_reproduced';
 END IF;
 RAISE NOTICE 'READY_WORKER_SCHEMA_VALID_RELEASED_HISTORY_OLD_VS_FIXED_SELECTION_PASS';
END $$;
ROLLBACK;
