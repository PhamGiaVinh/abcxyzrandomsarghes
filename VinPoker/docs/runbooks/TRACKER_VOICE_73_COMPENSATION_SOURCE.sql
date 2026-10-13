-- Compensation SOURCE only: promote to NEW reviewed migration for live.
-- Restores known deadlock baseline3f; not a remediation and not an auto retry.
-- Preserve all assignment/attendance/receipt/chip/payroll/audit rows.
BEGIN;
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'0a9e1f4e0972015b1554d6cd10f5ee2a'
 OR (SELECT md5(jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)::text) FROM pg_proc WHERE oid='public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure)<>'0289c33bd59043938c89f034dc7235c5' THEN RAISE EXCEPTION 'rollback73_source_or_metadata_drift'; END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.operator_perform_swing(p_table_id uuid, p_table_session_id uuid, p_assignment_id uuid, p_expected_version integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_club_id uuid;
  v_pre_assigned_attendance_id uuid;
  v_existing public.dealer_swing_operator_requests%ROWTYPE;
  v_created boolean := false;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SWING_OPERATOR_UNAUTHENTICATED';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'SWING_REQUEST_ID_REQUIRED';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'SWING_EXPECTED_VERSION_REQUIRED';
  END IF;

  SELECT gt.club_id INTO v_club_id
  FROM public.game_tables gt
  WHERE gt.id = p_table_id;

  IF v_club_id IS NULL
     OR NOT public.is_club_dealer_control(auth.uid(), v_club_id) THEN
    RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN';
  END IF;

  INSERT INTO public.dealer_swing_operator_requests (
    club_id, request_id, assignment_id, table_id, table_session_id, expected_version, actor_user_id
  ) VALUES (
    v_club_id, p_request_id, p_assignment_id, p_table_id, p_table_session_id, p_expected_version, auth.uid()
  )
  ON CONFLICT (club_id, request_id) DO NOTHING
  RETURNING true INTO v_created;

  IF NOT COALESCE(v_created, false) THEN
    SELECT * INTO v_existing
    FROM public.dealer_swing_operator_requests r
    WHERE r.club_id = v_club_id AND r.request_id = p_request_id
    FOR UPDATE;

    IF v_existing.assignment_id IS DISTINCT FROM p_assignment_id
       OR v_existing.table_id IS DISTINCT FROM p_table_id
       OR v_existing.table_session_id IS DISTINCT FROM p_table_session_id
       OR v_existing.expected_version IS DISTINCT FROM p_expected_version
       OR v_existing.actor_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'SWING_IDEMPOTENCY_CONFLICT';
    END IF;
    IF v_existing.response IS NULL THEN
      RAISE EXCEPTION 'SWING_REQUEST_IN_PROGRESS';
    END IF;
    RETURN v_existing.response || jsonb_build_object('idempotent', true);
  END IF;

  v_club_id := public._dealer_swing_assert_exact_context(
    p_table_id,
    p_table_session_id,
    p_assignment_id,
    p_expected_version,
    NULL
  );

  SELECT da.pre_assigned_attendance_id
  INTO v_pre_assigned_attendance_id
  FROM public.dealer_assignments da
  WHERE da.id = p_assignment_id;

  IF v_pre_assigned_attendance_id IS NOT NULL THEN
    PERFORM public._dealer_swing_assert_exact_context(
      p_table_id,
      p_table_session_id,
      p_assignment_id,
      p_expected_version,
      v_pre_assigned_attendance_id
    );
  END IF;

  v_result := public.perform_swing(
    p_assignment_id := p_assignment_id,
    p_expected_version := p_expected_version
  );
  v_result := public._dealer_swing_bind_result_session(
    v_result, v_club_id, p_table_id, p_table_session_id
  );

  UPDATE public.dealer_swing_operator_requests
  SET response = v_result, completed_at = now()
  WHERE club_id = v_club_id AND request_id = p_request_id;

  RETURN v_result;
END;
$function$;
DO $postcheck$
BEGIN
 IF md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'3f3e35df593064562056326969364bac'
 OR (SELECT md5(jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)::text) FROM pg_proc WHERE oid='public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure)<>'0289c33bd59043938c89f034dc7235c5' THEN RAISE EXCEPTION 'rollback73_definition_or_metadata_postcheck'; END IF;
END;
$postcheck$;
COMMIT;
