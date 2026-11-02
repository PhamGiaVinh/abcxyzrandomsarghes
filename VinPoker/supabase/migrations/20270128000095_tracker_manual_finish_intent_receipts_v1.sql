-- CLI candidate20261015210151; local source95 only, recheck live catalog before release.
-- Additive foundation. Bare record_hand is not retired here: ship consumer first,
-- then a separately reviewed forward retirement. Do not claim legacy intent safe.
-- Recovery: revoke these new entrypoints in a forward change; preserve receipts,
-- completed hands, chip projections and audit. No historical migration rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'514d543b756792fcfc3277faa325d991'
 OR to_regprocedure('floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)') IS NULL
 OR to_regprocedure('public.record_tracker_manual_hand_v1(jsonb)') IS NOT NULL
 OR to_regprocedure('public.get_tracker_manual_finish_receipt_v1(jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'manual_finish95_dependency_or_catalog_drift'; END IF;
END $guard$;

CREATE FUNCTION public.record_tracker_manual_hand_v1(p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='250ms'
AS $function$
DECLARE actor uuid:=auth.uid(); request_id uuid; hand_id uuid; session_id uuid; v_table_id uuid; tour_id uuid;
 epoch bigint; revision bigint; payload jsonb; receipt record; result jsonb;
 h public.tournament_hands%ROWTYPE; tt public.tournament_tables%ROWTYPE;
 session public.table_sessions%ROWTYPE; club uuid; physical uuid;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 OR actor IS DISTINCT FROM (p_intent->>'actor_id')::uuid THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR EXISTS(
  SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN ('actor_id','request_id','tournament_id',
  'tournament_table_id','hand_id','table_session_id','control_epoch','source_revision','payload')) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 request_id:=(p_intent->>'request_id')::uuid; hand_id:=(p_intent->>'hand_id')::uuid;
 session_id:=(p_intent->>'table_session_id')::uuid; v_table_id:=(p_intent->>'tournament_table_id')::uuid;
 tour_id:=(p_intent->>'tournament_id')::uuid; epoch:=(p_intent->>'control_epoch')::bigint;
 revision:=(p_intent->>'source_revision')::bigint; payload:=p_intent->'payload';
 IF request_id IS NULL OR hand_id IS NULL OR session_id IS NULL OR v_table_id IS NULL OR tour_id IS NULL
 OR epoch IS NULL OR epoch<1 OR revision IS NULL OR revision<1
 OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
 OR jsonb_typeof(payload->'players') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'actions') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'community_cards') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'side_pots') IS DISTINCT FROM 'array'
 OR jsonb_typeof(payload->'hand_time') IS DISTINCT FROM 'string'
 OR jsonb_typeof(payload->'pot_size') IS DISTINCT FROM 'number'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
  ('players','actions','community_cards','side_pots','hand_time','pot_size')) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 -- Same actor/operation/request lock as existing floor receipts, without an
 -- unbounded wait. A replay proves a past commit, not a fresh write permission.
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
 -- Acquire the core writer mutex before lifecycle locks. NOWAIT avoids a
 -- cycle with Floor physical/session-first transitions waiting on that mutex.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('tracker-unified-ops:'||tour_id::text,0)) THEN
  RETURN jsonb_build_object('ok',false,'error','manual_finish_busy'); END IF;
 PERFORM 1 FROM public.tournaments t WHERE t.id=tour_id AND t.club_id=club FOR UPDATE NOWAIT;
 SELECT * INTO tt FROM public.tournament_tables t WHERE t.id=v_table_id AND t.tournament_id=tour_id;
 physical:=coalesce(tt.game_table_id,tt.table_id);
 IF physical IS NULL THEN RETURN jsonb_build_object('ok',false,'error','stale_manual_finish_context'); END IF;
 PERFORM 1 FROM public.game_tables g WHERE g.id=physical AND g.club_id=club FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','stale_manual_finish_context'); END IF;
 SELECT * INTO session FROM public.table_sessions s WHERE s.id=session_id FOR SHARE NOWAIT;
 SELECT * INTO tt FROM public.tournament_tables t WHERE t.id=v_table_id FOR UPDATE NOWAIT;
 SELECT * INTO h FROM public.tournament_hands x WHERE x.id=hand_id FOR UPDATE NOWAIT;
 IF session.id IS NULL OR session.closed_at IS NOT NULL OR session.club_id IS DISTINCT FROM club
 OR session.tournament_id IS DISTINCT FROM tour_id OR session.game_table_id IS DISTINCT FROM physical
 OR session.control_mode IS DISTINCT FROM 'tracker' OR session.control_epoch IS DISTINCT FROM epoch
 OR tt.tournament_id IS DISTINCT FROM tour_id OR tt.table_session_id IS DISTINCT FROM session_id
 OR coalesce(tt.game_table_id,tt.table_id) IS DISTINCT FROM physical OR tt.status IS DISTINCT FROM 'active'
 OR h.id IS NULL OR h.tournament_id IS DISTINCT FROM tour_id OR h.tournament_table_id IS DISTINCT FROM v_table_id
 OR h.table_id IS DISTINCT FROM v_table_id OR h.table_session_id IS DISTINCT FROM session_id
 OR h.source_revision IS DISTINCT FROM revision OR h.status IS DISTINCT FROM 'in_progress' OR coalesce(h.is_voided,false) THEN
  RETURN jsonb_build_object('ok',false,'error','stale_manual_finish_context'); END IF;
 IF h.locked_by_user_id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('ok',false,'error','lock_not_held'); END IF;
 result:=public.record_hand(tour_id,v_table_id,h.hand_number,(payload->>'hand_time')::timestamptz,
  payload->'players',payload->'actions',payload->'side_pots',payload->'community_cards',(payload->>'pot_size')::integer,actor);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 IF result->>'hand_id' IS DISTINCT FROM hand_id::text THEN RAISE EXCEPTION 'manual_finish95_hand_result_mismatch'; END IF;
 result:=result||jsonb_build_object('actor_id',actor,'request_id',request_id,'intent',p_intent,
  'table_session_id',session_id,'control_epoch',epoch,'expected_source_revision',revision,
  'committed_source_revision',(SELECT source_revision FROM public.tournament_hands WHERE id=hand_id));
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'record_tracker_manual_hand_v1',request_id,p_intent::text,result);
 RETURN result;
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok',false,'error','manual_finish_busy');
 WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent');
END;
$function$;
REVOKE ALL ON FUNCTION public.record_tracker_manual_hand_v1(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_tracker_manual_hand_v1(jsonb) TO authenticated;

CREATE FUNCTION public.get_tracker_manual_finish_receipt_v1(p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; request_id uuid;
BEGIN
 IF actor IS NULL OR coalesce(auth.jwt()->>'role','')<>'authenticated'
 OR actor IS DISTINCT FROM (p_intent->>'actor_id')::uuid THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 request_id:=(p_intent->>'request_id')::uuid;
 IF request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent'); END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'record_tracker_manual_hand_v1',request_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','receipt_not_found'); END IF;
 IF receipt.request_fingerprint IS DISTINCT FROM p_intent::text THEN
  RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
 RETURN receipt.result;
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','invalid_finish_intent');
END;
$function$;
REVOKE ALL ON FUNCTION public.get_tracker_manual_finish_receipt_v1(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_manual_finish_receipt_v1(jsonb) TO authenticated;
COMMIT;
