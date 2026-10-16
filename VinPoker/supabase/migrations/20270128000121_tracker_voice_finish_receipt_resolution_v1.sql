-- CLI candidate 20261016141359; forward121 LOCAL ONLY. No table grant/writer change.
-- Recovery: disable Edge recovery consumer, revoke/drop ONLY this new function.
-- Preserve immutable Voice events, hands and all audit/payment/seat rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'voice_finish_receipt121_collision';
 END IF;
 IF to_regprocedure('public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)') IS NULL
 OR to_regclass('public.tracker_voice_events') IS NULL THEN RAISE EXCEPTION 'voice_finish_receipt121_dependency_missing';END IF;
END $$;
CREATE FUNCTION public.resolve_tracker_voice_finish_intent_v1(p_actor_user_id uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE root public.tracker_voice_events%ROWTYPE; committed public.tracker_voice_events%ROWTYPE; r jsonb;
BEGIN
 IF coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')<>'service_role' THEN
  RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501';END IF;
 IF p_actor_user_id IS NULL OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object'
 OR coalesce(p_intent->>'idempotency_key','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'
 OR coalesce(p_intent->>'state_version','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_intent->>'settlement_digest','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_intent->>'settlement_origin','') NOT IN ('engine_fold_win','engine_showdown') THEN
  RAISE EXCEPTION 'invalid_voice_finish_intent' USING ERRCODE='22023';END IF;
 -- Own historical receipt only, matching the existing writer's replay-before-
 -- assignment semantics. Never return root transcript, cards or another actor's event.
 SELECT * INTO root FROM public.tracker_voice_events e WHERE e.actor_user_id=p_actor_user_id
 AND e.idempotency_key=p_intent->>'idempotency_key' AND e.event_kind='final_transcript';
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unknown');END IF;
 IF root.tournament_id::text IS DISTINCT FROM p_intent->>'tournament_id'
 OR root.tournament_table_id::text IS DISTINCT FROM p_intent->>'tournament_table_id'
 OR root.hand_id::text IS DISTINCT FROM p_intent->>'hand_id'
 OR root.state_version IS DISTINCT FROM p_intent->>'state_version'
 OR root.provider_name IS DISTINCT FROM p_intent->>'provider_name'
 OR root.provider_model IS DISTINCT FROM coalesce(p_intent->>'provider_model',root.provider_model)
 OR root.provider_event_id IS DISTINCT FROM nullif(p_intent->>'provider_event_id','')
 OR root.final_transcript IS DISTINCT FROM p_intent->>'final_transcript'
 OR root.normalized_command->>'intent_domain' IS DISTINCT FROM 'finish_hand'
 OR root.normalized_command->>'settlement_origin' IS DISTINCT FROM p_intent->>'settlement_origin'
 OR root.normalized_command->>'settlement_digest' IS DISTINCT FROM p_intent->>'settlement_digest' THEN
  RETURN jsonb_build_object('status','conflict');END IF;
 SELECT * INTO committed FROM public.tracker_voice_events e WHERE e.root_event_id=root.id
 AND e.actor_user_id=p_actor_user_id AND e.event_kind='canonical_receipt';
 r:=committed.receipt;
 IF NOT FOUND OR r->>'ok' IS DISTINCT FROM 'true' OR r->>'voice_event_id' IS DISTINCT FROM root.id::text
 OR r->>'hand_id' IS DISTINCT FROM root.hand_id::text OR r->>'idempotency_key' IS DISTINCT FROM root.idempotency_key
 OR r->>'canonical_receipt_event_id' IS DISTINCT FROM committed.id::text
 OR r->>'settlement_origin' IS DISTINCT FROM p_intent->>'settlement_origin'
 OR r->>'settlement_digest' IS DISTINCT FROM p_intent->>'settlement_digest'
 OR r->>'state_version_before' IS DISTINCT FROM root.state_version
 OR coalesce(r->>'trace_id','')='' OR coalesce(r->>'state_version_after','') !~ '^[0-9a-f]{64}$'
 OR r->>'state_version_after'=root.state_version THEN
  RETURN jsonb_build_object('status','unavailable');END IF;
 RETURN jsonb_build_object('status','committed','receipt',r||jsonb_build_object('duplicate',true));
END $$;
REVOKE ALL ON FUNCTION public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb) TO service_role;
COMMIT;
