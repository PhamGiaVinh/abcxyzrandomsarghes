-- CLI 20261023203438 -> reserved265 after source/local-catalog collision checks.
-- Recovery only. Does not grant Undo capability, alter actions, or enable scopes.
-- Rollback after any cancellation: revoke cancel RPC, RETAIN writer fence/table.
-- Dropping a tombstone or restoring an unfenced writer could revive a late intent.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $preflight$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000265')
 OR to_regclass('private.tracker_undo_intent_cancellations_v1') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc WHERE proname='cancel_tracker_undo_intent_v1')
 OR md5(replace(pg_get_functiondef('public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'273b34a53a9114af87d9d8bc940dce38'
 OR md5(replace(pg_get_functiondef('public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure),chr(13),''))<>'0bb345117afb6ae5b851927052e9aa09'
 THEN RAISE EXCEPTION 'tracker_undo265_catalog_drift_or_collision'; END IF;
END $preflight$;

CREATE TABLE private.tracker_undo_intent_cancellations_v1 (
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 idempotency_key uuid NOT NULL,
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id),
 hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
 request_hash text NOT NULL CHECK(length(request_hash)=32),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_user_id,idempotency_key)
);
ALTER TABLE private.tracker_undo_intent_cancellations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.tracker_undo_intent_cancellations_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.undo_tracker_last_action_v1(
 p_tournament_id uuid,p_tournament_table_id uuid,p_hand_id uuid,
 p_expected_action_id uuid,p_expected_source_revision bigint,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 v_actor uuid:=auth.uid();v_request_hash text;
 v_existing public.tracker_correction_operations%ROWTYPE;
 v_cancel private.tracker_undo_intent_cancellations_v1%ROWTYPE;
 v_context jsonb;v_last public.hand_actions%ROWTYPE;v_hand public.tournament_hands%ROWTYPE;
 v_board_count integer;v_current_street text;v_legacy jsonb;v_receipt jsonb;
BEGIN
 IF v_actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','authentication_required');END IF;
 IF p_expected_action_id IS NULL OR p_expected_source_revision IS NULL
 OR p_expected_source_revision<1 OR p_idempotency_key IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 v_request_hash:=md5(jsonb_build_object('tournament_id',p_tournament_id,'tournament_table_id',p_tournament_table_id,
  'hand_id',p_hand_id,'action_id',p_expected_action_id,'source_revision',p_expected_source_revision)::text);
 -- Same actor/key serialization as cancellation, BEFORE checking either ledger.
 PERFORM pg_advisory_xact_lock(hashtextextended('tracker_undo_intent_v1:'||v_actor::text||':'||p_idempotency_key::text,0));
 SELECT * INTO v_existing FROM public.tracker_correction_operations
 WHERE actor_user_id=v_actor AND idempotency_key=p_idempotency_key FOR SHARE;
 IF FOUND THEN
  IF v_existing.request_hash<>v_request_hash THEN RETURN jsonb_build_object('ok',false,'error','request_key_conflict');END IF;
  RETURN v_existing.receipt||jsonb_build_object('duplicate',true);
 END IF;
 SELECT * INTO v_cancel FROM private.tracker_undo_intent_cancellations_v1
 WHERE actor_user_id=v_actor AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  RETURN jsonb_build_object('ok',false,'error',CASE WHEN v_cancel.request_hash=v_request_hash THEN 'undo_request_cancelled' ELSE 'request_key_conflict' END);
 END IF;
 -- Original authority, boundary and writer behavior remain unchanged below.
 v_context:=public._tracker_correction_uat_context(p_tournament_id,p_tournament_table_id,p_hand_id,'undo_open_hand');
 IF COALESCE((v_context->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_context;END IF;
 IF (v_context->>'source_revision')::bigint<>p_expected_source_revision THEN
  RETURN jsonb_build_object('ok',false,'error','stale_source_revision');END IF;
 SELECT * INTO v_hand FROM public.tournament_hands WHERE id=p_hand_id FOR UPDATE;
 SELECT * INTO v_last FROM public.hand_actions WHERE hand_id=p_hand_id
 ORDER BY action_order DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR v_last.id<>p_expected_action_id THEN RETURN jsonb_build_object('ok',false,'error','last_action_changed');END IF;
 IF v_last.action_type IN('post_sb','post_bb','post_ante') THEN RETURN jsonb_build_object('ok',false,'error','undo_boundary_blind');END IF;
 v_board_count:=jsonb_array_length(COALESCE(v_hand.community_cards,'[]'::jsonb));
 v_current_street:=CASE WHEN v_board_count>=5 THEN 'river' WHEN v_board_count=4 THEN 'turn' WHEN v_board_count=3 THEN 'flop' ELSE 'preflop' END;
 IF COALESCE(v_last.street,'preflop')<>v_current_street THEN RETURN jsonb_build_object('ok',false,'error','undo_boundary_board');END IF;
 v_legacy:=public.delete_last_action(p_hand_id,v_actor);
 IF v_legacy->>'status' IS DISTINCT FROM 'success' THEN RETURN jsonb_build_object('ok',false,'error',COALESCE(v_legacy->>'error','undo_failed'));END IF;
 SELECT * INTO v_hand FROM public.tournament_hands WHERE id=p_hand_id;
 v_receipt:=jsonb_build_object('ok',true,'duplicate',false,'operation','undo_open_hand','hand_id',p_hand_id,
  'undone_action_id',p_expected_action_id,'source_revision',v_hand.source_revision,'deleted',v_legacy->'deleted');
 INSERT INTO public.tracker_correction_operations(actor_user_id,tournament_id,tournament_table_id,hand_id,operation,idempotency_key,request_hash,receipt)
 VALUES(v_actor,p_tournament_id,p_tournament_table_id,p_hand_id,'undo_open_hand',p_idempotency_key,v_request_hash,v_receipt);
 INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
 VALUES((v_context->>'club_id')::uuid,v_actor,'tracker_open_hand_action_undone','tournament_hand',p_hand_id,v_receipt);
 RETURN v_receipt;
END $function$;

CREATE OR REPLACE FUNCTION public.get_tracker_undo_receipt_v1(
 p_tournament_id uuid,p_tournament_table_id uuid,p_hand_id uuid,
 p_expected_action_id uuid,p_expected_source_revision bigint,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 actor uuid:=auth.uid();club uuid;payload_hash text;
 operation public.tracker_correction_operations%ROWTYPE;
 cancellation private.tracker_undo_intent_cancellations_v1%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','authentication_required');END IF;
 IF p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_hand_id IS NULL OR p_expected_action_id IS NULL
 OR p_expected_source_revision IS NULL OR p_expected_source_revision<1 OR p_idempotency_key IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 SELECT t.club_id INTO club FROM public.tournaments t
 JOIN public.tournament_tables tt ON tt.tournament_id=t.id AND tt.id=p_tournament_table_id
 JOIN public.tournament_hands h ON h.id=p_hand_id AND h.tournament_id=t.id AND h.tournament_table_id=tt.id
 WHERE t.id=p_tournament_id;
 IF NOT FOUND OR public.is_club_tracker(actor,club) IS NOT TRUE THEN
  RETURN jsonb_build_object('ok',false,'error','tracker_scope_denied');END IF;
 payload_hash:=md5(jsonb_build_object('tournament_id',p_tournament_id,'tournament_table_id',p_tournament_table_id,
  'hand_id',p_hand_id,'action_id',p_expected_action_id,'source_revision',p_expected_source_revision)::text);
 SELECT * INTO operation FROM public.tracker_correction_operations o WHERE o.actor_user_id=actor AND o.idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF operation.operation<>'undo_open_hand' OR operation.request_hash<>payload_hash OR operation.tournament_id<>p_tournament_id
  OR operation.tournament_table_id<>p_tournament_table_id OR operation.hand_id<>p_hand_id THEN
   RETURN jsonb_build_object('ok',false,'error','request_key_conflict');END IF;
  RETURN jsonb_build_object('ok',true,'outcome','recorded','actor_id',actor,'request_id',p_idempotency_key,
   'receipt',operation.receipt||jsonb_build_object('duplicate',true));
 END IF;
 SELECT * INTO cancellation FROM private.tracker_undo_intent_cancellations_v1 c WHERE c.actor_user_id=actor AND c.idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF cancellation.request_hash<>payload_hash OR cancellation.tournament_id<>p_tournament_id
  OR cancellation.tournament_table_id<>p_tournament_table_id OR cancellation.hand_id<>p_hand_id THEN
   RETURN jsonb_build_object('ok',false,'error','request_key_conflict');END IF;
  RETURN jsonb_build_object('ok',true,'outcome','cancelled','actor_id',actor,'request_id',p_idempotency_key,'receipt',cancellation.receipt);
 END IF;
 RETURN jsonb_build_object('ok',true,'outcome','not_found','actor_id',actor,'request_id',p_idempotency_key);
END $function$;

CREATE FUNCTION public.cancel_tracker_undo_intent_v1(
 p_tournament_id uuid,p_tournament_table_id uuid,p_hand_id uuid,
 p_expected_action_id uuid,p_expected_source_revision bigint,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor uuid:=auth.uid();prior jsonb;payload_hash text;proof jsonb;club uuid;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','authentication_required');END IF;
 IF p_idempotency_key IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_request');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tracker_undo_intent_v1:'||actor::text||':'||p_idempotency_key::text,0));
 prior:=public.get_tracker_undo_receipt_v1(p_tournament_id,p_tournament_table_id,p_hand_id,p_expected_action_id,p_expected_source_revision,p_idempotency_key);
 IF prior->>'ok' IS DISTINCT FROM 'true' OR prior->>'outcome' IS DISTINCT FROM 'not_found' THEN RETURN prior;END IF;
 payload_hash:=md5(jsonb_build_object('tournament_id',p_tournament_id,'tournament_table_id',p_tournament_table_id,
  'hand_id',p_hand_id,'action_id',p_expected_action_id,'source_revision',p_expected_source_revision)::text);
 proof:=jsonb_build_object('ok',true,'operation','cancel_undo_open_hand','cancelled',true,'actor_id',actor,'request_id',p_idempotency_key,
  'tournament_id',p_tournament_id,'tournament_table_id',p_tournament_table_id,'hand_id',p_hand_id,
  'expected_action_id',p_expected_action_id,'expected_source_revision',p_expected_source_revision);
 INSERT INTO private.tracker_undo_intent_cancellations_v1(actor_user_id,idempotency_key,tournament_id,tournament_table_id,hand_id,request_hash,receipt)
 VALUES(actor,p_idempotency_key,p_tournament_id,p_tournament_table_id,p_hand_id,payload_hash,proof);
 SELECT club_id INTO club FROM public.tournaments WHERE id=p_tournament_id;
 INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(club,actor,'tracker_undo_intent_cancelled','tournament_hand',p_hand_id,proof);
 RETURN jsonb_build_object('ok',true,'outcome','cancelled','actor_id',actor,'request_id',p_idempotency_key,'receipt',proof);
END $function$;

ALTER FUNCTION public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO postgres;
ALTER FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO postgres;
ALTER FUNCTION public.cancel_tracker_undo_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cancel_tracker_undo_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracker_undo_receipt_v1(uuid,uuid,uuid,uuid,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_tracker_undo_intent_v1(uuid,uuid,uuid,uuid,bigint,uuid) TO authenticated;
COMMIT;
