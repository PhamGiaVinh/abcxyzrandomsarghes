-- CLI candidate 20261016105943, forward118 after local collision/catalog check.
-- LOCAL candidate, NOT approved/applied live. Read-only business semantics.
-- Recovery: disable Edge resolve consumer, revoke/drop ONLY this new function.
-- Preserve hands, outcomes, queue and browser journals. Never replay archive.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.resolve_tracker_correction_intent_v1(uuid,uuid,uuid,text,bigint,text,text,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'correction_intent118_already_exists';
 END IF;
 IF to_regprocedure('public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)') IS NULL
 OR to_regprocedure('public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text)') IS NULL THEN
  RAISE EXCEPTION 'correction_intent118_dependency_missing';
 END IF;
 IF md5(replace(pg_get_functiondef('public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure),chr(13),''))<>'9d871978a3f3b5ab816177d2ede98a97'
 OR md5(replace(pg_get_functiondef('public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure),chr(13),''))<>'e8cfff114af0a396ce72bf70a2f03f0b' THEN
  RAISE EXCEPTION 'correction_intent118_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.resolve_tracker_correction_intent_v1(
 p_hand_id uuid,p_tournament_id uuid,p_actor_user_id uuid,p_idempotency_key text,
 p_expected_source_revision bigint,p_expected_source_chain_hash text,p_expected_outcome_hash text,p_expected_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE h public.tournament_hands%ROWTYPE; o public.tournament_settlement_outcomes%ROWTYPE;
 club uuid; receipt jsonb; result_status text;
BEGIN
 IF coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501';
 END IF;
 IF p_hand_id IS NULL OR p_tournament_id IS NULL OR p_actor_user_id IS NULL
 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 255
 OR p_expected_source_revision IS NULL OR p_expected_source_revision NOT BETWEEN 1 AND 9007199254740991
 OR p_expected_source_chain_hash IS NULL OR p_expected_source_chain_hash !~ '^[0-9a-f]{64}$'
 OR p_expected_outcome_hash IS NULL OR p_expected_outcome_hash !~ '^[0-9a-f]{64}$'
 OR p_expected_request_hash IS NULL OR p_expected_request_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid_correction_intent' USING ERRCODE='22023';
 END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF NOT FOUND OR (public.is_club_owner(p_actor_user_id,club) OR public.is_club_admin(p_actor_user_id,club)) IS NOT TRUE THEN
  RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE='42501';
 END IF;
 -- Lock only the hand, not tournament afterwards: the correction writer already
 -- locks tournament->hand, while History locks hand->tournament. Plain auth reads
 -- above introduce no opposing row lock. All correction source CAS needs this hand.
 SELECT * INTO h FROM public.tournament_hands WHERE id=p_hand_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_target_hand' USING ERRCODE='22023'; END IF;
 SELECT * INTO o FROM public.tournament_settlement_outcomes
  WHERE tournament_id=p_tournament_id AND idempotency_key=p_idempotency_key FOR SHARE;
 IF FOUND THEN
  IF o.hand_id IS DISTINCT FROM p_hand_id OR o.actor_user_id IS DISTINCT FROM p_actor_user_id
   OR o.request_hash IS DISTINCT FROM p_expected_request_hash OR o.outcome_hash IS DISTINCT FROM p_expected_outcome_hash
   OR o.public_outcome->>'sourceRevision' IS DISTINCT FROM p_expected_source_revision::text
   OR o.public_outcome->>'sourceChainHash' IS DISTINCT FROM p_expected_source_chain_hash
   OR o.verification_scope IS DISTINCT FROM 'chain' OR o.correction_reason IS NULL THEN
   RAISE EXCEPTION 'idempotency_mismatch' USING ERRCODE='22023';
  END IF;
  receipt:=jsonb_build_object('ok',true,'idempotent',true,'settlement_revision',o.settlement_revision,'outcome_hash',o.outcome_hash);
  result_status:='receipt_found';
 ELSIF h.source_revision>p_expected_source_revision THEN result_status:='intent_obsolete';
 ELSE result_status:='receipt_not_found'; END IF;
 RETURN jsonb_build_object('ok',true,'status',result_status,'actor_id',p_actor_user_id,'tournament_id',p_tournament_id,
  'hand_id',p_hand_id,'idempotency_key',p_idempotency_key,'source_revision',p_expected_source_revision,
  'source_chain_hash',p_expected_source_chain_hash,'outcome_hash',p_expected_outcome_hash,'request_hash',p_expected_request_hash,
  'current_source_revision',h.source_revision,'receipt',receipt);
END $$;
ALTER FUNCTION public.resolve_tracker_correction_intent_v1(uuid,uuid,uuid,text,bigint,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_tracker_correction_intent_v1(uuid,uuid,uuid,text,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_tracker_correction_intent_v1(uuid,uuid,uuid,text,bigint,text,text,text) TO service_role;
COMMIT;
