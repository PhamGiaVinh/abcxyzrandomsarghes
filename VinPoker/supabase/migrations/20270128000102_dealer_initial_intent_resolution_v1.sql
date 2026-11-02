-- CLI candidate20261015235941; local forward102, not approved/applied live.
-- Read/lock only. Missing receipt is terminal ONLY for a proven closed exact
-- session with no legacy assignment commit; never infer from current supply.
-- Recovery: disable new Edge/UI consumers, then revoke/drop only this reader.
-- Preserve assignments, receipts, sessions and client journals.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF to_regprocedure('public.resolve_dealer_initial_assignment_intent_v1(uuid,uuid,uuid,uuid,uuid,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'initial_intent102_already_exists';
 END IF;
 IF md5(replace(pg_get_functiondef('public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text)'::regprocedure),chr(13),''))<>'f69e7e1da758389192a74654ce7eaba1'
 OR md5(replace(pg_get_functiondef('public.worker_read_initial_assignment_receipt_v1(text,uuid,uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'4ecb325063873acfdba78e5bfc0fbdc1' THEN
  RAISE EXCEPTION 'initial_intent102_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.resolve_dealer_initial_assignment_intent_v1(
 p_actor_user_id uuid,p_club_id uuid,p_table_id uuid,p_table_session_id uuid,p_dealer_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE request_key text; receipt jsonb; closed timestamptz; state text;
BEGIN
 IF coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
  coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_actor_user_id IS NULL OR p_club_id IS NULL OR p_table_id IS NULL OR p_table_session_id IS NULL
 OR p_dealer_id IS NULL OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'INITIAL_ASSIGNMENT_INVALID_INTENT' USING ERRCODE='22023';
 END IF;
 IF public.is_club_dealer_control(p_actor_user_id,p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 request_key:='open_manual_'||p_actor_user_id::text||'_'||p_request_id::text;
 -- Canonical worker22: request-key advisory -> physical table -> exact session.
 PERFORM pg_catalog.pg_advisory_xact_lock(280017,pg_catalog.hashtext(request_key));
 IF public.is_club_dealer_control(p_actor_user_id,p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 receipt:=public.worker_read_initial_assignment_receipt_v1(request_key,p_club_id,p_table_id,p_table_session_id,p_dealer_id);
 IF receipt IS NOT NULL THEN
  IF receipt->>'outcome' IS DISTINCT FROM 'ok' THEN
   RAISE EXCEPTION 'INITIAL_ASSIGNMENT_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('status','receipt_found','receipt',receipt);
 END IF;
 PERFORM 1 FROM public.game_tables WHERE id=p_table_id AND club_id=p_club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INITIAL_ASSIGNMENT_CONTEXT_MISMATCH' USING ERRCODE='22023'; END IF;
 SELECT s.closed_at INTO closed FROM public.table_sessions s
 WHERE s.id=p_table_session_id AND s.game_table_id=p_table_id AND s.club_id=p_club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INITIAL_ASSIGNMENT_CONTEXT_MISMATCH' USING ERRCODE='22023'; END IF;
 IF public.is_club_dealer_control(p_actor_user_id,p_club_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_assignments WHERE idempotency_key=request_key) THEN
  -- Older assignment commits may lack the full receipt. Never discard these.
  state:='legacy_receipt_review_required';
 ELSE
  state:=CASE WHEN closed IS NOT NULL THEN 'intent_obsolete' ELSE 'receipt_not_found' END;
 END IF;
 RETURN jsonb_build_object('status',state,'receipt',NULL);
END $$;
REVOKE ALL ON FUNCTION public.resolve_dealer_initial_assignment_intent_v1(uuid,uuid,uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_dealer_initial_assignment_intent_v1(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
