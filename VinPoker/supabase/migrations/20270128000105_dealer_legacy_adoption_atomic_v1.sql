-- CLIcandidate20261016010447; forward local105, NOT applied live.
-- Adopt only an already-owned live legacy lock. No new dealer acquisition,
-- rest/OT/payroll policy or history repair. Preserve existing 3-minute lead.
-- Recovery: stop workers, revoke this endpoint/restore compatible reviewed Edge;
-- retain all assignments/schedule history, never restore split client writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required';END IF;
 IF to_regprocedure('public.worker_adopt_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'legacy_adoption105_object_collision';END IF;
 IF to_regprocedure('public.worker_clear_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid)') IS NULL THEN
  RAISE EXCEPTION 'legacy_adoption105_dependency_missing';END IF;
END $$;
CREATE FUNCTION public.worker_adopt_legacy_preassignment_v1(
 p_club_id uuid,p_table_id uuid,p_table_session_id uuid,p_assignment_id uuid,
 p_expected_version integer,p_incoming_attendance_id uuid,p_plan_run_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE a public.dealer_assignments%ROWTYPE; incoming public.dealer_attendance%ROWTYPE;
 existing public.dealer_rotation_schedule%ROWTYPE; schedule_id uuid; relief timestamptz; outcome text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_club_id IS NULL OR p_table_id IS NULL OR p_table_session_id IS NULL OR p_assignment_id IS NULL
  OR p_expected_version IS NULL OR p_incoming_attendance_id IS NULL OR p_plan_run_id IS NULL THEN
  RAISE EXCEPTION 'LEGACY_ADOPTION_INTENT_REQUIRED' USING ERRCODE='22023';END IF;
 PERFORM floor_private.assert_dealer_acquisition_intent(p_club_id);
 PERFORM 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_ADOPTION_TABLE_MISMATCH' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM public.table_sessions WHERE id=p_table_session_id AND game_table_id=p_table_id
  AND club_id=p_club_id AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_ADOPTION_SESSION_CHANGED' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.dealer_assignments WHERE id=p_assignment_id AND club_id=p_club_id
  AND table_id=p_table_id AND table_session_id=p_table_session_id AND status='assigned' AND released_at IS NULL
  AND pre_assigned_attendance_id=p_incoming_attendance_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_ADOPTION_SNAPSHOT_CHANGED' USING ERRCODE='22023';END IF;
 SELECT dat.* INTO incoming FROM public.dealer_attendance dat JOIN public.dealers d ON d.id=dat.dealer_id
  WHERE dat.id=p_incoming_attendance_id AND d.club_id=p_club_id AND d.status='active' AND d.deleted_at IS NULL
  AND dat.status='checked_in' AND dat.check_out_time IS NULL AND dat.current_state='pre_assigned'
  AND dat.pre_assigned_table_id=p_table_id FOR UPDATE OF dat;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','repair_required');END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id<>p_assignment_id AND released_at IS NULL
   AND status IN ('assigned','on_break','reserved','pre_assigned','in_transition')
   AND (attendance_id=p_incoming_attendance_id OR pre_assigned_attendance_id=p_incoming_attendance_id))
 OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE assignment_id<>p_assignment_id
   AND in_attendance_id=p_incoming_attendance_id AND status IN ('announced','executing')) THEN
  RETURN jsonb_build_object('outcome','repair_required');END IF;
 SELECT * INTO existing FROM public.dealer_rotation_schedule WHERE assignment_id=p_assignment_id
  AND slot_index=0 AND status IN ('predicted','announced','executing') ORDER BY id LIMIT 1;
 IF FOUND THEN
  IF existing.status<>'announced' OR existing.club_id IS DISTINCT FROM p_club_id
   OR existing.table_id IS DISTINCT FROM p_table_id OR existing.in_attendance_id IS DISTINCT FROM p_incoming_attendance_id
   OR existing.out_attendance_id IS DISTINCT FROM a.attendance_id
   OR existing.planned_relief_at IS DISTINCT FROM a.planned_relief_at
   OR existing.solver_version IS DISTINCT FROM 'adopted-legacy'
   OR existing.reason->>'adoption_expected_version' IS DISTINCT FROM p_expected_version::text THEN
   RETURN jsonb_build_object('outcome','repair_required');END IF;
  schedule_id:=existing.id;relief:=existing.planned_relief_at;outcome:='already_adopted';
 ELSE
  IF a.version IS DISTINCT FROM p_expected_version THEN
   RAISE EXCEPTION 'LEGACY_ADOPTION_VERSION_CHANGED' USING ERRCODE='22023';END IF;
  IF a.swing_due_at IS NULL THEN RETURN jsonb_build_object('outcome','repair_required');END IF;
  relief:=greatest(a.swing_due_at,now()+interval '3 minutes');
  INSERT INTO public.dealer_rotation_schedule(club_id,table_id,assignment_id,slot_index,out_attendance_id,
   in_attendance_id,planned_relief_at,announce_at,status,is_shortage,is_emergency,plan_run_id,solver_version,reason)
  VALUES(p_club_id,p_table_id,p_assignment_id,0,a.attendance_id,p_incoming_attendance_id,relief,now(),
   'announced',false,a.swing_due_at<=now(),p_plan_run_id,'adopted-legacy',
   jsonb_build_object('adopted_from','pre_assigned_attendance_id','adoption_expected_version',p_expected_version)) RETURNING id INTO schedule_id;
  UPDATE public.dealer_assignments SET planned_relief_at=relief,updated_at=now() WHERE id=p_assignment_id;
  outcome:='adopted';
 END IF;
 RETURN jsonb_build_object('outcome',outcome,'club_id',p_club_id,'table_id',p_table_id,
  'table_session_id',p_table_session_id,'assignment_id',p_assignment_id,'expected_version',p_expected_version,
  'incoming_attendance_id',p_incoming_attendance_id,'schedule_id',schedule_id,'planned_relief_at',relief);
END;
$$;
REVOKE ALL ON FUNCTION public.worker_adopt_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_adopt_legacy_preassignment_v1(uuid,uuid,uuid,uuid,integer,uuid,uuid) TO service_role;
COMMIT;
