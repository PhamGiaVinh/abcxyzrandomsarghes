-- CLI candidate20261016064633, local catalog110. NOT RELEASED.
-- Scheduled swap, completion and replay receipt share one transaction.
-- Recovery: stop automatic workers and restore compatible Edge; retain receipts,
-- assignments and schedule history. Never compensate with a second blind swap.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required';END IF;
 IF to_regprocedure('public.worker_execute_rotation_slot_v1(uuid,integer,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)') IS NOT NULL THEN
  RAISE EXCEPTION 'rotation_execution110_object_collision';END IF;
 IF md5(replace(pg_get_functiondef('public.worker_execute_pre_assigned_swing(uuid,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)'::regprocedure),chr(13),''))<>'7d9657b45d7d7ac98dd379d15d4a8b30'
 OR md5(replace(pg_get_functiondef('public.complete_rotation_slot(uuid,uuid)'::regprocedure),chr(13),''))<>'5b323b5e2a24a151a320af417a3c6024' THEN
  RAISE EXCEPTION 'rotation_execution110_dependency_drift';END IF;
END $$;
CREATE FUNCTION public.worker_execute_rotation_slot_v1(
 p_schedule_id uuid,p_expected_schedule_version integer,p_table_session_id uuid,
 p_old_assignment_id uuid,p_expected_assignment_version integer,p_next_attendance_id uuid,
 p_swing_due_at timestamptz,p_duration_minutes integer,p_send_to_break boolean DEFAULT false,
 p_break_duration_minutes integer DEFAULT 15
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE s public.dealer_rotation_schedule%ROWTYPE; a public.dealer_assignments%ROWTYPE;
 session_row public.table_sessions%ROWTYPE; payload jsonb; receipt jsonb; result jsonb; completed jsonb;
 effective_role text:=pg_catalog.current_setting('role',true);
BEGIN
 IF effective_role IS NULL OR effective_role='none'
  OR NOT pg_catalog.pg_has_role(effective_role,'service_role','MEMBER')
  OR auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_schedule_id IS NULL OR p_expected_schedule_version IS NULL OR p_table_session_id IS NULL
  OR p_old_assignment_id IS NULL OR p_expected_assignment_version IS NULL OR p_next_attendance_id IS NULL
  OR p_swing_due_at IS NULL OR p_duration_minutes IS NULL OR p_duration_minutes<=0
  OR p_send_to_break IS NULL OR p_break_duration_minutes IS NULL OR p_break_duration_minutes<0 THEN
  RAISE EXCEPTION 'ROTATION_EXECUTION_INTENT_REQUIRED' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('schedule_id',p_schedule_id,'schedule_version',p_expected_schedule_version,
  'session_id',p_table_session_id,'assignment_id',p_old_assignment_id,'assignment_version',p_expected_assignment_version,
  'incoming',p_next_attendance_id,'swing_due_at',p_swing_due_at,'duration',p_duration_minutes,
  'send_to_break',p_send_to_break,'break_duration',p_break_duration_minutes);
 SELECT * INTO s FROM public.dealer_rotation_schedule WHERE id=p_schedule_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROTATION_EXECUTION_SCHEDULE_MISSING' USING ERRCODE='22023';END IF;
 receipt:=s.reason->'execution_receipt_v1';
 IF receipt IS NOT NULL THEN
  IF ((receipt->'payload')-'swing_due_at') IS DISTINCT FROM (payload-'swing_due_at')
   OR (receipt#>>'{payload,swing_due_at}')::timestamptz IS DISTINCT FROM p_swing_due_at THEN
   RAISE EXCEPTION 'ROTATION_EXECUTION_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';END IF;
  RETURN receipt->'result';
 END IF;
 PERFORM floor_private.assert_dealer_acquisition_intent(s.club_id);
 PERFORM 1 FROM public.game_tables WHERE id=s.table_id AND club_id=s.club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROTATION_EXECUTION_TABLE_MISMATCH' USING ERRCODE='22023';END IF;
 SELECT * INTO session_row FROM public.table_sessions WHERE id=p_table_session_id
  AND game_table_id=s.table_id AND club_id=s.club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_SESSION_STALE' USING ERRCODE='22023';END IF;
 -- Raw cancellation locks schedule before assignment. Hold the physical/session
 -- parents first, then schedule, BEFORE invoking the existing assignment executor.
 SELECT * INTO s FROM public.dealer_rotation_schedule WHERE id=p_schedule_id FOR UPDATE;
 IF NOT FOUND OR s.table_id IS DISTINCT FROM session_row.game_table_id
  OR s.club_id IS DISTINCT FROM session_row.club_id THEN
  RAISE EXCEPTION 'ROTATION_EXECUTION_SCOPE_CHANGED' USING ERRCODE='22023';END IF;
 receipt:=s.reason->'execution_receipt_v1';
 IF receipt IS NOT NULL THEN
  IF ((receipt->'payload')-'swing_due_at') IS DISTINCT FROM (payload-'swing_due_at')
   OR (receipt#>>'{payload,swing_due_at}')::timestamptz IS DISTINCT FROM p_swing_due_at THEN
   RAISE EXCEPTION 'ROTATION_EXECUTION_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';END IF;
  RETURN receipt->'result';
 END IF;
 IF session_row.closed_at IS NOT NULL THEN RAISE EXCEPTION 'TABLE_SESSION_STALE' USING ERRCODE='22023';END IF;
 IF s.status NOT IN ('announced','executing') OR s.slot_index<>0
  OR s.version IS DISTINCT FROM p_expected_schedule_version
  OR s.assignment_id IS DISTINCT FROM p_old_assignment_id
  OR s.in_attendance_id IS DISTINCT FROM p_next_attendance_id
  OR s.planned_relief_at IS NULL OR s.planned_relief_at>now()
  OR s.announce_at IS NULL OR s.announce_at>now() THEN
  RAISE EXCEPTION 'ROTATION_EXECUTION_SCHEDULE_CHANGED' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.dealer_assignments WHERE id=p_old_assignment_id
  AND club_id=s.club_id AND table_id=s.table_id AND table_session_id=p_table_session_id
  AND version=p_expected_assignment_version AND status='assigned' AND released_at IS NULL
  AND attendance_id=s.out_attendance_id AND pre_assigned_attendance_id=p_next_attendance_id
  AND planned_relief_at=s.planned_relief_at FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROTATION_EXECUTION_ASSIGNMENT_CHANGED' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE assignment_id=a.id AND id<>s.id
  AND status IN ('announced','executing')) THEN
  RAISE EXCEPTION 'ROTATION_EXECUTION_SCHEDULE_AMBIGUOUS' USING ERRCODE='22023';END IF;
 result:=public.worker_execute_pre_assigned_swing(s.table_id,p_table_session_id,p_old_assignment_id,
  p_expected_assignment_version,p_next_attendance_id,p_swing_due_at,p_duration_minutes,p_send_to_break,p_break_duration_minutes);
 IF result->>'status' IS DISTINCT FROM 'success' OR result->>'new_assignment_id' IS NULL THEN
  -- An inner function may catch its exception and return JSON after writes.
  -- Raising here rolls back every write in this outer transaction too.
  RAISE EXCEPTION 'ROTATION_EXECUTION_SWAP_REJECTED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id=(result->>'new_assignment_id')::uuid
  AND club_id=s.club_id AND table_id=s.table_id AND table_session_id=p_table_session_id
  AND attendance_id=p_next_attendance_id AND status='assigned' AND released_at IS NULL) THEN
  RAISE EXCEPTION 'ROTATION_EXECUTION_RESULT_MISMATCH';END IF;
 completed:=public.complete_rotation_slot(s.id,(result->>'new_assignment_id')::uuid);
 IF completed->>'outcome' IS DISTINCT FROM 'executed' OR completed->>'schedule_id' IS DISTINCT FROM s.id::text THEN
  RAISE EXCEPTION 'ROTATION_EXECUTION_COMPLETION_FAILED';END IF;
 result:=result||jsonb_build_object('rotation_schedule_id',s.id,'rotation_completion','executed');
 UPDATE public.dealer_rotation_schedule SET reason=reason||jsonb_build_object('execution_receipt_v1',
  jsonb_build_object('payload',payload,'result',result)) WHERE id=s.id AND status='executed';
 IF NOT FOUND THEN RAISE EXCEPTION 'ROTATION_EXECUTION_RECEIPT_FAILED';END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.worker_execute_rotation_slot_v1(uuid,integer,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_execute_rotation_slot_v1(uuid,integer,uuid,uuid,integer,uuid,timestamptz,integer,boolean,integer) TO service_role;
COMMIT;
