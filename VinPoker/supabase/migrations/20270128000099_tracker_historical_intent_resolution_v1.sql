-- CLI candidate20261015224458; local forward99, NOT approved/applied live.
-- Additive service-only resolution: no hand, outcome, queue or receipt writes.
-- A missing receipt alone is not terminal. Serialize with the commit's hand
-- row lock, re-read the receipt, then require a strictly newer source revision.
-- Recovery: revoke/drop this new function after disabling its Edge consumer;
-- preserve existing readers/writers, outcomes, history and client journals.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'historical_intent99_already_exists';
 END IF;
 IF to_regprocedure('public.get_tracker_historical_display_commit_receipt(uuid,uuid,uuid,text,bigint,text,text)') IS NULL
 OR to_regprocedure('public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)') IS NULL THEN
  RAISE EXCEPTION 'historical_intent99_dependency_missing';
 END IF;
 IF md5(replace(pg_get_functiondef('public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)'::regprocedure),chr(13),''))<>'fcf8dac1239f25742e1c9566d523aa25'
 OR md5(replace(pg_get_functiondef('public.get_tracker_historical_display_commit_receipt(uuid,uuid,uuid,text,bigint,text,text)'::regprocedure),chr(13),''))<>'10f5be573cbcddbd10806cd11b98389d' THEN
  RAISE EXCEPTION 'historical_intent99_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.resolve_tracker_historical_display_intent_v1(
 p_hand_id uuid, p_tournament_id uuid, p_actor_user_id uuid, p_idempotency_key text,
 p_expected_source_revision bigint, p_expected_source_chain_hash text, p_expected_outcome_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE hand_row public.tournament_hands%ROWTYPE; club uuid; receipt jsonb; result_status text;
BEGIN
 IF coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501';
 END IF;
 IF p_hand_id IS NULL OR p_tournament_id IS NULL OR p_actor_user_id IS NULL
 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 255
 OR p_expected_source_revision IS NULL OR p_expected_source_revision<1
 OR p_expected_source_revision>9007199254740991
 OR p_expected_source_chain_hash IS NULL OR p_expected_source_chain_hash !~ '^[0-9a-f]{64}$'
 OR p_expected_outcome_hash IS NULL OR p_expected_outcome_hash !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'invalid_historical_intent' USING ERRCODE='22023';
 END IF;
 -- Same lock order as the real commit: hand -> tournament -> outcome.
 SELECT * INTO hand_row FROM public.tournament_hands WHERE id=p_hand_id FOR UPDATE;
 IF NOT FOUND OR hand_row.tournament_id IS DISTINCT FROM p_tournament_id THEN
  RAISE EXCEPTION 'invalid_historical_hand' USING ERRCODE='22023';
 END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id FOR SHARE;
 IF NOT FOUND OR (public.is_club_owner(p_actor_user_id,club) OR public.is_club_admin(p_actor_user_id,club)) IS NOT TRUE THEN
  RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE='42501';
 END IF;
 receipt:=public.get_tracker_historical_display_commit_receipt(p_hand_id,p_tournament_id,p_actor_user_id,
  p_idempotency_key,p_expected_source_revision,p_expected_source_chain_hash,p_expected_outcome_hash);
 IF receipt IS NOT NULL THEN result_status:='receipt_found';
 ELSIF hand_row.source_revision>p_expected_source_revision THEN result_status:='intent_obsolete';
 ELSE result_status:='receipt_not_found'; END IF;
 RETURN jsonb_build_object('ok',true,'status',result_status,'actor_id',p_actor_user_id,
  'tournament_id',p_tournament_id,'hand_id',p_hand_id,'idempotency_key',p_idempotency_key,
  'source_revision',p_expected_source_revision,'source_chain_hash',p_expected_source_chain_hash,
  'outcome_hash',p_expected_outcome_hash,'current_source_revision',hand_row.source_revision,'receipt',receipt);
END $$;
ALTER FUNCTION public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_tracker_historical_display_intent_v1(uuid,uuid,uuid,text,bigint,text,text) TO service_role;
COMMIT;
