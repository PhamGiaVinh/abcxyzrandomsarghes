-- Forward80 candidate: exact-session operator intent for next dealer, with or
-- without a planner slot. Requires reviewed rest78 and close79 before rollout.
-- No historical backfill, current-dealer handoff, rest/payroll or grant widening.
-- Restore: disable this new RPC grant through a reviewed forward migration;
-- preserve receipts, plans and audit. Do not resurrect previous reservations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'operator_next_intent_collision';
 END IF;
END $$;
CREATE FUNCTION public.operator_plan_next_dealer_v1(
 p_table_session_id uuid,p_assignment_id uuid,p_expected_assignment_version integer,
 p_next_attendance_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor uuid:=auth.uid(); session_row public.table_sessions%ROWTYPE;
 assignment_row public.dealer_assignments%ROWTYPE; plan_row public.dealer_rotation_schedule%ROWTYPE;
 physical_id uuid; scope_id uuid; fingerprint text; receipt record; result jsonb; plan_count integer;
 incoming public.dealer_attendance%ROWTYPE; incoming_club uuid;
BEGIN
 IF actor IS NULL OR p_table_session_id IS NULL OR p_assignment_id IS NULL
  OR p_expected_assignment_version IS NULL OR p_next_attendance_id IS NULL OR p_request_id IS NULL THEN
  RETURN jsonb_build_object('outcome','invalid_request');
 END IF;
 SELECT game_table_id,club_id INTO physical_id,scope_id FROM public.table_sessions WHERE id=p_table_session_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','session_not_active'); END IF;
 IF floor_private.floor_table_v3_actor_is_dealer_operator(actor,scope_id) IS NOT TRUE THEN
  RETURN jsonb_build_object('outcome','forbidden');
 END IF;
 fingerprint:=jsonb_build_object('session',p_table_session_id,'assignment',p_assignment_id,
  'version',p_expected_assignment_version,'next',p_next_attendance_id)::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'operator_plan_next_dealer_v1',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'operator_plan_next_dealer_v1',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN RETURN jsonb_build_object('outcome','idempotency_conflict'); END IF;
  RETURN receipt.result;
 END IF;
 PERFORM 1 FROM public.game_tables WHERE id=physical_id AND club_id=scope_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','scope_mismatch'); END IF;
 SELECT * INTO session_row FROM public.table_sessions WHERE id=p_table_session_id FOR UPDATE;
 IF NOT FOUND OR session_row.closed_at IS NOT NULL OR session_row.game_table_id IS DISTINCT FROM physical_id
  OR session_row.club_id IS DISTINCT FROM scope_id THEN RETURN jsonb_build_object('outcome','session_not_active'); END IF;
 -- Same schedule -> assignment order as planner and canonical close79.
 FOR plan_row IN SELECT * FROM public.dealer_rotation_schedule
  WHERE table_id=physical_id AND slot_index=0 AND status IN ('predicted','announced','executing')
  ORDER BY id FOR UPDATE LOOP
  IF plan_row.club_id IS DISTINCT FROM scope_id OR plan_row.assignment_id IS DISTINCT FROM p_assignment_id
   OR plan_row.slot_index<>0 OR plan_row.status='executing' THEN
   RETURN jsonb_build_object('outcome','plan_requires_repair');
  END IF;
 END LOOP;
 SELECT count(*) INTO plan_count FROM public.dealer_rotation_schedule
  WHERE table_id=physical_id AND slot_index=0 AND status IN ('predicted','announced','executing');
 IF plan_count>1 THEN RETURN jsonb_build_object('outcome','plan_requires_repair'); END IF;
 SELECT * INTO assignment_row FROM public.dealer_assignments WHERE id=p_assignment_id FOR UPDATE;
 IF NOT FOUND OR assignment_row.table_session_id IS DISTINCT FROM p_table_session_id
  OR assignment_row.club_id IS DISTINCT FROM scope_id OR assignment_row.table_id IS DISTINCT FROM physical_id
  OR assignment_row.status IS DISTINCT FROM 'assigned' OR assignment_row.released_at IS NOT NULL
  OR assignment_row.swing_processed_at IS NOT NULL THEN RETURN jsonb_build_object('outcome','assignment_not_active'); END IF;
 IF assignment_row.version IS DISTINCT FROM p_expected_assignment_version THEN RETURN jsonb_build_object('outcome','race_lost'); END IF;
 IF assignment_row.attendance_id=p_next_attendance_id THEN RETURN jsonb_build_object('outcome','current_dealer'); END IF;
 IF plan_count=0 AND (assignment_row.pre_assigned_attendance_id IS NOT NULL OR assignment_row.swing_due_at IS NULL) THEN
  RETURN jsonb_build_object('outcome','plan_requires_repair');
 END IF;
 -- Forecast slots1..2 are advisory and never reserve attendance. Preserve them.
 -- Lock the actual incoming attendance and verify live operational identity;
 -- optional web user identity is deliberately irrelevant.
 SELECT da.* INTO incoming FROM public.dealer_attendance da WHERE id=p_next_attendance_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','dealer_unavailable'); END IF;
 SELECT club_id INTO incoming_club FROM public.dealers WHERE id=incoming.dealer_id;
 IF incoming_club IS DISTINCT FROM scope_id OR incoming.status IS DISTINCT FROM 'checked_in'
  OR incoming.check_out_time IS NOT NULL THEN RETURN jsonb_build_object('outcome','dealer_unavailable'); END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_assignments other WHERE other.id<>p_assignment_id
  AND other.released_at IS NULL AND
  (other.attendance_id=p_next_attendance_id OR other.pre_assigned_attendance_id=p_next_attendance_id)) THEN
  RETURN jsonb_build_object('outcome','dealer_already_reserved');
 END IF;
 IF incoming.current_state IS DISTINCT FROM 'available'
  AND NOT (plan_count=1 AND plan_row.in_attendance_id=p_next_attendance_id
    AND assignment_row.pre_assigned_attendance_id=p_next_attendance_id
    AND incoming.current_state='pre_assigned' AND incoming.pre_assigned_table_id=physical_id) THEN
  RETURN jsonb_build_object('outcome','dealer_unavailable');
 END IF;
 -- The canonical writer must already enforce rest15. Do not silently delegate
 -- to the old rest10 body when frontend/backend releases are out of sequence.
 IF md5(pg_get_functiondef('public.set_rotation_slot_dealer(uuid,integer,uuid,text)'::regprocedure))
  <> '54fe092e15f6b90b54a51d130fec32c9' THEN RETURN jsonb_build_object('outcome','backend_not_ready'); END IF;
 BEGIN
  IF plan_count=0 THEN
   INSERT INTO public.dealer_rotation_schedule(club_id,table_id,assignment_id,slot_index,planned_relief_at,plan_run_id,solver_version)
   VALUES(scope_id,physical_id,p_assignment_id,0,assignment_row.swing_due_at,p_request_id,'operator_next_intent_v1')
   RETURNING * INTO plan_row;
  END IF;
  -- An advisory predicted candidate is not a locked reservation. Canonical
  -- set-slot treats same dealer as no-op, so clear only this advisory pointer
  -- inside the locked subtransaction, retain its provenance and use the normal
  -- rest15 writer to create the actual lock. Rejection rolls this change back.
  IF plan_row.status='predicted' AND plan_row.in_attendance_id=p_next_attendance_id
   AND assignment_row.pre_assigned_attendance_id IS NULL THEN
   UPDATE public.dealer_rotation_schedule SET in_attendance_id=NULL,version=version+1,
    reason=COALESCE(reason,'{}'::jsonb)||jsonb_build_object('operator_confirmed_prediction',
      jsonb_build_object('attendance_id',p_next_attendance_id,'actor_id',actor,'request_id',p_request_id))
   WHERE id=plan_row.id AND version=plan_row.version RETURNING * INTO plan_row;
   IF NOT FOUND THEN RAISE EXCEPTION 'operator_next_prediction_cas_failed'; END IF;
  END IF;
  result:=public.set_rotation_slot_dealer(plan_row.id,plan_row.version,p_next_attendance_id,'floor_manual_next');
  IF result->>'outcome' NOT IN ('changed','noop_same_dealer') OR result->>'outcome' IS NULL THEN
   RAISE EXCEPTION 'operator_next_delegate_rejected';
  END IF;
  result:=result||jsonb_build_object('table_session_id',p_table_session_id,'assignment_id',p_assignment_id,'request_id',p_request_id);
  PERFORM floor_private.floor_table_v3_save_receipt(actor,'operator_plan_next_dealer_v1',p_request_id,fingerprint,result);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='operator_next_delegate_rejected' THEN RETURN result; END IF;
  RAISE;
 END;
 RETURN result;
END $function$;
ALTER FUNCTION public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid) TO authenticated;
COMMIT;
