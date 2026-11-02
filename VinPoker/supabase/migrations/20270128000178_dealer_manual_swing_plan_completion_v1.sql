-- CLI candidate20261019072209, reserved local178. NOT RELEASED.
-- Manual handoff and announced-plan completion must commit together.
-- No historical repair, payroll/rest policy or grants changed.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE
 target regprocedure:='public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure;
 definition text; before_metadata jsonb; after_metadata jsonb; anchor text;
BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf'
 OR md5(replace(pg_get_functiondef('public.complete_rotation_slot(uuid,uuid)'::regprocedure),chr(13),''))<>'5b323b5e2a24a151a320af417a3c6024'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000178') THEN
  RAISE EXCEPTION 'manual_swing178_precondition_drift';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,
  'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_metadata FROM pg_proc WHERE oid=target;
 IF before_metadata->>'owner'<>'postgres' OR before_metadata->>'definer'<>'true'
 OR before_metadata->>'acl'<>'{postgres=X/postgres,authenticated=X/postgres}'
 OR before_metadata->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb
 OR has_function_privilege('authenticated','public.complete_rotation_slot(uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.complete_rotation_slot(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'manual_swing178_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 anchor:='  v_result jsonb;';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'manual_swing178_declaration_anchor';END IF;
 definition:=replace(definition,anchor,anchor||$declarations$
  v_slot public.dealer_rotation_schedule%ROWTYPE;
  v_announced public.dealer_rotation_schedule%ROWTYPE;
  v_plan_id uuid;
  v_new_assignment uuid;
  v_completed jsonb;
$declarations$);
 anchor:='  v_club_id := public._dealer_swing_assert_exact_context(';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'manual_swing178_lock_anchor';END IF;
 definition:=replace(definition,anchor,$locks$
  -- Match close/planner order: physical table (already held), session,
  -- schedule, assignment. Never acquire a schedule after holding assignment.
  PERFORM 1 FROM public.table_sessions ts WHERE ts.id=p_table_session_id
    AND ts.game_table_id=p_table_id AND ts.club_id=v_club_id AND ts.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_SESSION_STALE';END IF;
  FOR v_slot IN SELECT * FROM public.dealer_rotation_schedule rs
    WHERE rs.table_id=p_table_id AND rs.slot_index=0 AND rs.status IN('predicted','announced','executing')
    ORDER BY rs.id FOR UPDATE
  LOOP
    IF v_slot.club_id IS DISTINCT FROM v_club_id OR v_slot.assignment_id IS DISTINCT FROM p_assignment_id
      OR v_slot.status='executing' THEN RAISE EXCEPTION 'MANUAL_SWING_PLAN_CONTEXT_CHANGED';END IF;
    IF v_slot.status='announced' THEN
      IF v_plan_id IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_SWING_PLAN_AMBIGUOUS';END IF;
      v_plan_id:=v_slot.id;v_announced:=v_slot;
    END IF;
  END LOOP;
$locks$||anchor);
 anchor:='  v_result := public.perform_swing(';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'manual_swing178_incoming_anchor';END IF;
 definition:=replace(definition,anchor,$incoming$
  IF v_plan_id IS NOT NULL AND (
    v_announced.in_attendance_id IS NULL
    OR v_announced.in_attendance_id IS DISTINCT FROM v_pre_assigned_attendance_id
    OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=p_assignment_id
      AND a.table_session_id=p_table_session_id AND a.club_id=v_club_id AND a.table_id=p_table_id
      AND a.released_at IS NULL AND a.status='assigned'
      AND a.planned_relief_at IS NOT DISTINCT FROM v_announced.planned_relief_at
      AND (v_announced.out_attendance_id IS NULL OR v_announced.out_attendance_id=a.attendance_id))) THEN
    RAISE EXCEPTION 'MANUAL_SWING_PLAN_INCOMING_CHANGED';
  END IF;
$incoming$||anchor);
 anchor:='  UPDATE public.dealer_swing_operator_requests';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'manual_swing178_completion_anchor';END IF;
 definition:=replace(definition,anchor,$completion$
  IF v_plan_id IS NOT NULL AND v_result->>'outcome'='swung' THEN
    v_new_assignment:=(v_result->>'new_assignment_id')::uuid;
    IF v_new_assignment IS NULL OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments a
      WHERE a.id=v_new_assignment AND a.club_id=v_club_id AND a.table_id=p_table_id
      AND a.table_session_id=p_table_session_id AND a.attendance_id=v_announced.in_attendance_id
      AND a.status='assigned' AND a.released_at IS NULL)
      OR NOT EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.id=p_assignment_id
        AND a.table_session_id=p_table_session_id AND a.released_at IS NOT NULL AND a.status='completed') THEN
      RAISE EXCEPTION 'MANUAL_SWING_PLAN_RESULT_MISMATCH';END IF;
    -- Invoked only inside this authorized postgres-owned transaction. The
    -- bookkeeping function stays uncallable by browser roles.
    v_completed:=public.complete_rotation_slot(v_plan_id,v_new_assignment);
    IF v_completed->>'outcome' IS DISTINCT FROM 'executed'
      OR v_completed->>'schedule_id' IS DISTINCT FROM v_plan_id::text THEN
      RAISE EXCEPTION 'MANUAL_SWING_PLAN_COMPLETION_FAILED';END IF;
    UPDATE public.dealer_rotation_schedule SET reason=coalesce(reason,'{}'::jsonb)||jsonb_build_object(
      'operator_execution_v1',jsonb_build_object('actor_id',auth.uid(),'request_id',p_request_id,
        'old_assignment_id',p_assignment_id,'new_assignment_id',v_new_assignment))
      WHERE id=v_plan_id AND status='executed';
    IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_SWING_PLAN_RECEIPT_FAILED';END IF;
    v_result:=v_result||jsonb_build_object('rotation_schedule_id',v_plan_id,'rotation_completion','executed');
  END IF;
$completion$||anchor);
 EXECUTE definition;
 IF replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN RAISE EXCEPTION 'manual_swing178_body_postcheck';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,
  'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_metadata FROM pg_proc WHERE oid=target;
 IF before_metadata IS DISTINCT FROM after_metadata
 OR has_function_privilege('authenticated','public.complete_rotation_slot(uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.complete_rotation_slot(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'manual_swing178_metadata_postcheck';END IF;
END;
$migration$;
COMMIT;
