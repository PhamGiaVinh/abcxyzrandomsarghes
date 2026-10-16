-- CLI candidate20261016005612; forward local104, NOT applied live.
-- Replace split client cleanup only. No adoption, payroll/rest/history repair.
-- Recovery: stop automatic workers; revoke this new endpoint, restore reviewed
-- Edge artifact. Keep all operational/history rows; never restore split writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF to_regprocedure('public.worker_clear_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'legacy_cleanup104_object_collision';
 END IF;
 IF to_regprocedure('floor_private.assert_dealer_acquisition_intent(uuid)') IS NULL THEN
  RAISE EXCEPTION 'legacy_cleanup104_dependency_missing';
 END IF;
END $$;
CREATE FUNCTION public.worker_clear_legacy_preassignment_v1(
 p_club_id uuid,p_table_id uuid,p_table_session_id uuid,p_assignment_id uuid,
 p_expected_version integer,p_incoming_attendance_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE assignment_row public.dealer_assignments%ROWTYPE; incoming public.dealer_attendance%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_club_id IS NULL OR p_table_id IS NULL OR p_table_session_id IS NULL OR p_assignment_id IS NULL
  OR p_expected_version IS NULL OR p_incoming_attendance_id IS NULL THEN
  RAISE EXCEPTION 'LEGACY_PREASSIGN_INTENT_REQUIRED' USING ERRCODE='22023';
 END IF;
 -- Automatic OFF-at-commit fence, then canonical physical/session order.
 PERFORM floor_private.assert_dealer_acquisition_intent(p_club_id);
 PERFORM 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_PREASSIGN_TABLE_MISMATCH' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.table_sessions WHERE id=p_table_session_id AND game_table_id=p_table_id
  AND club_id=p_club_id AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_PREASSIGN_SESSION_CHANGED' USING ERRCODE='22023'; END IF;
 SELECT * INTO assignment_row FROM public.dealer_assignments WHERE id=p_assignment_id
  AND club_id=p_club_id AND table_id=p_table_id AND table_session_id=p_table_session_id
  AND status='assigned' AND released_at IS NULL AND version=p_expected_version
  AND pre_assigned_attendance_id=p_incoming_attendance_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_PREASSIGN_SNAPSHOT_CHANGED' USING ERRCODE='22023'; END IF;
 SELECT a.* INTO incoming FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
  WHERE a.id=p_incoming_attendance_id AND d.club_id=p_club_id FOR UPDATE OF a;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','repair_required'); END IF;
 IF incoming.current_state='pre_assigned' AND incoming.status='checked_in' AND incoming.check_out_time IS NULL THEN
  RETURN jsonb_build_object('outcome','legacy_lock_valid');
 END IF;
 -- Ambiguous ownership is not permission to release another table's dealer.
 IF EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE assignment_id=p_assignment_id
   AND status IN ('predicted','announced','executing'))
 OR EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id<>p_assignment_id AND released_at IS NULL
   AND (attendance_id=p_incoming_attendance_id OR pre_assigned_attendance_id=p_incoming_attendance_id)
   AND status IN ('assigned','on_break','reserved','pre_assigned','in_transition'))
 OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE in_attendance_id=p_incoming_attendance_id
   AND status IN ('announced','executing'))
 OR (incoming.current_state='pre_assigned' AND incoming.pre_assigned_table_id IS DISTINCT FROM p_table_id)
 OR incoming.current_state IN ('assigned','in_transition') THEN
  RETURN jsonb_build_object('outcome','repair_required');
 END IF;
 UPDATE public.dealer_assignments SET pre_assigned_attendance_id=NULL,pre_assigned_at=NULL,
  planned_relief_at=NULL,is_emergency_pre_assign=false,updated_at=now() WHERE id=p_assignment_id;
 IF incoming.current_state='pre_assigned' THEN
  UPDATE public.dealer_attendance SET current_state=CASE WHEN status='checked_in' AND check_out_time IS NULL
    THEN 'available' ELSE 'checked_out' END,
   pre_assigned_table_id=NULL,pre_assigned_at=NULL,updated_at=now() WHERE id=p_incoming_attendance_id;
 END IF;
 RETURN jsonb_build_object('outcome','cleared','club_id',p_club_id,'table_id',p_table_id,
  'table_session_id',p_table_session_id,'assignment_id',p_assignment_id,
  'expected_version',p_expected_version,'incoming_attendance_id',p_incoming_attendance_id);
END;
$$;
REVOKE ALL ON FUNCTION public.worker_clear_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_clear_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid) TO service_role;
COMMIT;
