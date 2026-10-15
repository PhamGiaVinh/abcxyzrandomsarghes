-- CLI candidate20261015232616; local forward100, not approved/applied live.
-- Observation only: receipt_not_found is NOT proof that an in-flight writer
-- rolled back. Retry must retain the exact original request tuple.
-- Recovery: disable the new client consumer, then revoke/drop only this reader;
-- preserve all operator receipts and existing mutation functions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF to_regprocedure('public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'manual_swing100_already_exists';
 END IF;
 IF md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'a25a91e02d6f2c0399e5aba1086e4acf' THEN
  RAISE EXCEPTION 'manual_swing100_writer_drift';
 END IF;
END $$;
CREATE FUNCTION public.get_dealer_manual_swing_receipt_v1(
 p_actor_user_id uuid, p_club_id uuid, p_table_id uuid,
 p_table_session_id uuid, p_assignment_id uuid,
 p_expected_version integer, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.dealer_swing_operator_requests%ROWTYPE; result_status text;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_user_id
 OR p_club_id IS NULL
 OR public.is_club_dealer_control(auth.uid(),p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_table_id IS NULL OR p_table_session_id IS NULL OR p_assignment_id IS NULL
 OR p_expected_version IS NULL OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'SWING_RECEIPT_INVALID_INTENT' USING ERRCODE='22023';
 END IF;
 -- Never join active assignments: a successful swing retires the source row.
 -- Current club authority and exact actor/payload still gate historical reads.
 SELECT * INTO receipt FROM public.dealer_swing_operator_requests r
 WHERE r.club_id=p_club_id AND r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
  OR receipt.table_id IS DISTINCT FROM p_table_id
  OR receipt.table_session_id IS DISTINCT FROM p_table_session_id
  OR receipt.assignment_id IS DISTINCT FROM p_assignment_id
  OR receipt.expected_version IS DISTINCT FROM p_expected_version THEN
   RAISE EXCEPTION 'SWING_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';
  END IF;
  result_status:=CASE WHEN receipt.response IS NULL THEN 'request_in_progress' ELSE 'receipt_found' END;
 ELSE
  result_status:='receipt_not_found';
 END IF;
 RETURN jsonb_build_object('status',result_status,'actor_user_id',p_actor_user_id,
  'club_id',p_club_id,'table_id',p_table_id,'table_session_id',p_table_session_id,
  'assignment_id',p_assignment_id,'expected_version',p_expected_version,
  'request_id',p_request_id,'response',receipt.response);
END $$;
REVOKE ALL ON FUNCTION public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_dealer_manual_swing_receipt_v1(uuid,uuid,uuid,uuid,uuid,integer,uuid)
 TO authenticated;
COMMIT;
