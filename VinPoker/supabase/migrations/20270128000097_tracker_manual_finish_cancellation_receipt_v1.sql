-- CLI candidate20261015213838; local forward97, not approved for production apply.
-- Cancellation fences this actor/request only; it never voids or edits a hand.
-- Keep tombstones on rollback: revoke this entrypoint, never delete receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.record_tracker_manual_hand_v1(jsonb)'::regprocedure),chr(13),''))<>'29c8223e91774dc4767ab72a334e7b56'
 OR md5(replace(pg_get_functiondef('public.get_tracker_manual_finish_receipt_v1(jsonb)'::regprocedure),chr(13),''))<>'0c8908aa7ba9176653abe50aa3472025'
 OR to_regprocedure('public.cancel_tracker_manual_finish_v1(jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'manual_finish_cancellation_dependency_or_catalog_drift'; END IF;
END $guard$;

CREATE FUNCTION public.cancel_tracker_manual_finish_v1(p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='250ms'
AS $function$
DECLARE actor uuid:=auth.uid(); request_id uuid; hand_id uuid; session_id uuid;
 tour_id uuid; logical_table uuid; epoch bigint; revision bigint; club uuid;
 payload jsonb; receipt record; result jsonb;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 OR actor IS DISTINCT FROM (p_intent->>'actor_id')::uuid THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_intent))<>9
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN
 ('actor_id','request_id','tournament_id','tournament_table_id','hand_id','table_session_id','control_epoch','source_revision','payload')) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 request_id:=(p_intent->>'request_id')::uuid; hand_id:=(p_intent->>'hand_id')::uuid;
 session_id:=(p_intent->>'table_session_id')::uuid; tour_id:=(p_intent->>'tournament_id')::uuid;
 logical_table:=(p_intent->>'tournament_table_id')::uuid;
 epoch:=(p_intent->>'control_epoch')::bigint; revision:=(p_intent->>'source_revision')::bigint;
 payload:=p_intent->'payload';
 IF request_id IS NULL OR hand_id IS NULL OR session_id IS NULL OR tour_id IS NULL OR logical_table IS NULL
 OR epoch IS NULL OR epoch<1 OR revision IS NULL OR revision<1
 OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(payload))<>6
 OR jsonb_typeof(payload->'players') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'actions') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'community_cards') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'side_pots') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'hand_time') IS DISTINCT FROM 'string'
 OR jsonb_typeof(payload->'pot_size') IS DISTINCT FROM 'number' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 -- Exactly the writer's request mutex and receipt namespace. The winner
 -- commits either the real outcome or a tombstone; the loser returns it.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(actor::text||':record_tracker_manual_hand_v1:'||request_id::text,0)) THEN
  RETURN jsonb_build_object('ok',false,'error','manual_finish_busy'); END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'record_tracker_manual_hand_v1',request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM p_intent::text THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN receipt.result;
 END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=tour_id AND t.deleted_at IS NULL;
 IF club IS NULL OR public.is_club_tracker(actor,club) IS NOT TRUE THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 -- A stale epoch/session may be cancelled, but cannot become new write
 -- authority. Require the declared hand identity, not today's active table.
 PERFORM 1 FROM public.tournament_hands h WHERE h.id=hand_id AND h.tournament_id=tour_id
 AND h.tournament_table_id=logical_table AND h.table_session_id=session_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','stale_manual_finish_context'); END IF;
 result:=jsonb_build_object('ok',true,'status','cancelled','actor_id',actor,'request_id',request_id,
 'intent',p_intent,'hand_id',hand_id,'table_session_id',session_id,'control_epoch',epoch,'expected_source_revision',revision);
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'record_tracker_manual_hand_v1',request_id,p_intent::text,result);
 RETURN result;
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'error','manual_finish_busy');
 WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent');
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_tracker_manual_finish_v1(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_tracker_manual_finish_v1(jsonb) TO authenticated;
COMMIT;
