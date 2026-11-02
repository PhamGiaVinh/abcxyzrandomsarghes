-- CLIcandidate20261016011958; local forward106, NOT applied live.
-- Atomic emergency cancellation/preparation, never release a seated dealer.
-- Preserve rest/OT/payroll and schedule history. Recovery: stop workers,
-- revoke new endpoint/restore compatible reviewed Edge, retain all data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required';END IF;
 IF to_regprocedure('public.worker_prepare_emergency_replan_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid[],text)') IS NOT NULL THEN
  RAISE EXCEPTION 'emergency106_object_collision';END IF;
 IF to_regprocedure('public.cancel_rotation_slot(uuid,text)') IS NULL
  OR to_regprocedure('public.worker_adopt_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'emergency106_dependency_missing';END IF;
END $$;
CREATE FUNCTION public.worker_prepare_emergency_replan_v1(
 p_club_id uuid,p_table_id uuid,p_table_session_id uuid,p_assignment_id uuid,p_expected_version integer,
 p_incoming_attendance_id uuid,p_schedule_ids uuid[],p_cancel_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE a public.dealer_assignments%ROWTYPE; incoming public.dealer_attendance%ROWTYPE;
 s public.dealer_rotation_schedule%ROWTYPE; locked_ids uuid[]:='{}'; requested_ids uuid[];
 cancelled jsonb; expected_outcome text; final_version integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_club_id IS NULL OR p_table_id IS NULL OR p_table_session_id IS NULL OR p_assignment_id IS NULL
  OR p_expected_version IS NULL OR p_schedule_ids IS NULL OR array_position(p_schedule_ids,NULL) IS NOT NULL
  OR p_cancel_reason IS NULL OR p_cancel_reason NOT IN ('invalid_preassign','incoming_not_rested','no_show','race_lost') THEN
  RAISE EXCEPTION 'EMERGENCY_REPLAN_INTENT_REQUIRED' USING ERRCODE='22023';END IF;
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}'::uuid[]) INTO requested_ids FROM unnest(p_schedule_ids) id;
 IF cardinality(requested_ids)<>cardinality(p_schedule_ids) THEN
  RAISE EXCEPTION 'EMERGENCY_REPLAN_SCHEDULE_DUPLICATE' USING ERRCODE='22023';END IF;
 PERFORM floor_private.assert_dealer_acquisition_intent(p_club_id);
 PERFORM 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMERGENCY_REPLAN_TABLE_MISMATCH' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.table_sessions WHERE id=p_table_session_id AND game_table_id=p_table_id
  AND club_id=p_club_id AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMERGENCY_REPLAN_SESSION_CHANGED' USING ERRCODE='22023';END IF;
 -- Raw cancel_rotation_slot locks schedule before assignment. Preserve that
 -- order inside the physical/session fence shared by close and worker writers.
 FOR s IN SELECT * FROM public.dealer_rotation_schedule WHERE assignment_id=p_assignment_id
  AND status IN ('predicted','announced','executing') ORDER BY id FOR UPDATE LOOP
  locked_ids:=array_append(locked_ids,s.id);
 END LOOP;
 IF locked_ids IS DISTINCT FROM requested_ids THEN
  RAISE EXCEPTION 'EMERGENCY_REPLAN_SCHEDULE_CHANGED' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.dealer_assignments WHERE id=p_assignment_id AND club_id=p_club_id
  AND table_id=p_table_id AND table_session_id=p_table_session_id AND status='assigned' AND released_at IS NULL
  AND version=p_expected_version AND pre_assigned_attendance_id IS NOT DISTINCT FROM p_incoming_attendance_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMERGENCY_REPLAN_SNAPSHOT_CHANGED' USING ERRCODE='22023';END IF;
 IF p_incoming_attendance_id IS NOT NULL THEN
  SELECT dat.* INTO incoming FROM public.dealer_attendance dat JOIN public.dealers d ON d.id=dat.dealer_id
   WHERE dat.id=p_incoming_attendance_id AND d.club_id=p_club_id FOR UPDATE OF dat;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','repair_required');END IF;
  IF incoming.current_state IN ('assigned','in_transition')
   OR (incoming.current_state<>'pre_assigned' AND incoming.pre_assigned_table_id IS NOT NULL)
   OR (incoming.current_state='pre_assigned' AND incoming.pre_assigned_table_id IS DISTINCT FROM p_table_id)
   OR (incoming.pre_assigned_table_id IS NOT NULL AND incoming.pre_assigned_table_id IS DISTINCT FROM p_table_id)
   OR EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id<>p_assignment_id AND released_at IS NULL
    AND status IN ('assigned','on_break','reserved','pre_assigned','in_transition')
    AND (attendance_id=p_incoming_attendance_id OR pre_assigned_attendance_id=p_incoming_attendance_id))
   OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE assignment_id<>p_assignment_id
    AND in_attendance_id=p_incoming_attendance_id AND status IN ('announced','executing')) THEN
   RETURN jsonb_build_object('outcome','repair_required');END IF;
 END IF;
 -- Validate EVERY row before any cancellation; ambiguity never authorizes a
 -- different incoming/table lock to be released.
 FOR s IN SELECT * FROM public.dealer_rotation_schedule WHERE id=ANY(locked_ids) ORDER BY id LOOP
  IF s.club_id IS DISTINCT FROM p_club_id OR s.table_id IS DISTINCT FROM p_table_id OR s.status='executing'
   OR (s.status='announced' AND (s.in_attendance_id IS DISTINCT FROM p_incoming_attendance_id
    OR p_incoming_attendance_id IS NULL)) THEN RETURN jsonb_build_object('outcome','repair_required');END IF;
 END LOOP;
 expected_outcome:=CASE WHEN p_cancel_reason='no_show' THEN 'no_show' ELSE 'cancelled' END;
 FOR s IN SELECT * FROM public.dealer_rotation_schedule WHERE id=ANY(locked_ids) ORDER BY id LOOP
  cancelled:=public.cancel_rotation_slot(s.id,p_cancel_reason);
  IF cancelled->>'outcome' IS DISTINCT FROM expected_outcome OR cancelled->>'schedule_id' IS DISTINCT FROM s.id::text THEN
   RAISE EXCEPTION 'EMERGENCY_REPLAN_CANCEL_FAILED';END IF;
 END LOOP;
 UPDATE public.dealer_assignments SET pre_assigned_attendance_id=NULL,pre_assigned_at=NULL,
  planned_relief_at=NULL,is_emergency_pre_assign=false,updated_at=now() WHERE id=p_assignment_id
  AND (pre_assigned_attendance_id IS NOT NULL OR pre_assigned_at IS NOT NULL
   OR planned_relief_at IS NOT NULL OR is_emergency_pre_assign IS TRUE);
 IF p_incoming_attendance_id IS NOT NULL AND incoming.current_state='pre_assigned' THEN
   UPDATE public.dealer_attendance SET current_state=CASE WHEN status='checked_in' AND check_out_time IS NULL
    THEN 'available' ELSE 'checked_out' END,pre_assigned_table_id=NULL,pre_assigned_at=NULL,updated_at=now()
    WHERE id=p_incoming_attendance_id;
 END IF;
 SELECT version INTO final_version FROM public.dealer_assignments WHERE id=p_assignment_id;
 RETURN jsonb_build_object('outcome','prepared','club_id',p_club_id,'table_id',p_table_id,
  'table_session_id',p_table_session_id,'assignment_id',p_assignment_id,'expected_version',p_expected_version,
  'incoming_attendance_id',p_incoming_attendance_id,'schedule_ids',locked_ids,
  'assignment_version',final_version,'cancelled_count',cardinality(locked_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.worker_prepare_emergency_replan_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid[],text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_prepare_emergency_replan_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid[],text) TO service_role;
COMMIT;
