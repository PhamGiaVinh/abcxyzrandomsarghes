-- CLI candidate20261015233550; local forward101, not approved/applied live.
-- Cancellation is not undo: serialize with the original writer's physical-table
-- lock, preserve a committed result, otherwise insert an immutable tombstone
-- through the existing exact-payload receipt. Late writers replay cancellation.
-- Recovery: disable new consumers then revoke new entrypoints. Preserve all
-- cancellation receipts: deleting them would allow delayed requests to execute.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF to_regprocedure('public.cancel_dealer_manual_swing_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)') IS NOT NULL
 OR to_regprocedure('public.operator_perform_swing_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'manual_swing101_already_exists';
 END IF;
 IF md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf'
 OR to_regprocedure('public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)') IS NULL THEN
  RAISE EXCEPTION 'manual_swing101_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.operator_perform_swing_v2(
 p_actor_user_id uuid,p_club_id uuid,p_table_id uuid,p_table_session_id uuid,
 p_assignment_id uuid,p_expected_version integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_user_id
 OR p_club_id IS NULL OR public.is_club_dealer_control(auth.uid(),p_club_id) IS NOT TRUE
 OR NOT EXISTS(SELECT 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id) THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 -- Fence expected club before delegating; the reusable physical table cannot
 -- change clubs between this intent check and the original writer's commit.
 PERFORM 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id FOR UPDATE;
 IF NOT FOUND OR public.is_club_dealer_control(auth.uid(),p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN public.operator_perform_swing(p_table_id,p_table_session_id,p_assignment_id,p_expected_version,p_request_id);
END $$;
CREATE FUNCTION public.cancel_dealer_manual_swing_v1(
 p_actor_user_id uuid,p_club_id uuid,p_table_id uuid,p_table_session_id uuid,
 p_assignment_id uuid,p_expected_version integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE receipt public.dealer_swing_operator_requests%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_user_id
 OR p_club_id IS NULL OR public.is_club_dealer_control(auth.uid(),p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_table_id IS NULL OR p_table_session_id IS NULL OR p_assignment_id IS NULL
 OR p_expected_version IS NULL OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'SWING_RECEIPT_INVALID_INTENT' USING ERRCODE='22023';
 END IF;
 -- Same order as operator_perform_swing73: physical table -> receipt/FKs.
 PERFORM 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id FOR UPDATE;
 IF NOT FOUND OR public.is_club_dealer_control(auth.uid(),p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT * INTO receipt FROM public.dealer_swing_operator_requests
 WHERE club_id=p_club_id AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  -- Reader enforces actor and whole payload; never replace a stored outcome.
  RETURN public.get_dealer_manual_swing_receipt_v1(p_actor_user_id,p_club_id,p_table_id,
   p_table_session_id,p_assignment_id,p_expected_version,p_request_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id
  WHERE a.id=p_assignment_id AND a.table_id=p_table_id AND a.club_id=p_club_id
  AND a.table_session_id=p_table_session_id AND s.game_table_id=p_table_id AND s.club_id=p_club_id) THEN
  RAISE EXCEPTION 'SWING_ASSIGNMENT_CONTEXT_MISMATCH' USING ERRCODE='22023';
 END IF;
 -- Current assignment version/status may have changed; this old request must
 -- still be cancellable. Its immutable original version stays in the receipt.
 INSERT INTO public.dealer_swing_operator_requests(club_id,request_id,assignment_id,table_id,
  table_session_id,expected_version,actor_user_id,response,completed_at)
 VALUES(p_club_id,p_request_id,p_assignment_id,p_table_id,p_table_session_id,p_expected_version,
  p_actor_user_id,jsonb_build_object('outcome','cancelled','request_id',p_request_id),now());
 RETURN public.get_dealer_manual_swing_receipt_v1(p_actor_user_id,p_club_id,p_table_id,
  p_table_session_id,p_assignment_id,p_expected_version,p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.operator_perform_swing_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_dealer_manual_swing_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_perform_swing_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_dealer_manual_swing_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid) TO authenticated;
COMMIT;
