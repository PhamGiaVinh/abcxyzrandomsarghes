-- LOCAL campaign candidate. CLI-generated file ordered after qualified chain134.
-- No mutation, no receipt-table grants. Rollback: revoke this function grant.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.multi_day_bag_requests_v1') IS NULL
    OR to_regclass('public.multi_day_close_requests_v1') IS NULL THEN
   RAISE EXCEPTION 'multiday_bag_receipt_prerequisite_missing';
 END IF;
END $$;

CREATE FUNCTION public.multi_day_get_bagging_receipt_v1(
 p_flight_tournament_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_club uuid; v_player uuid; v_dealer uuid;
 v_action text; v_result jsonb; v_hash text;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 IF p_flight_tournament_id IS NULL OR p_request_id IS NULL THEN
   RAISE EXCEPTION 'multi_day_receipt_request_invalid' USING ERRCODE='22023';
 END IF;
 SELECT f.club_id INTO v_club FROM public.multi_day_flight_ends_v1 f
 WHERE f.flight_tournament_id=p_flight_tournament_id;
 IF v_club IS NULL THEN RAISE EXCEPTION 'multi_day_receipt_actor_not_allowed' USING ERRCODE='42501'; END IF;
 SELECT r.player_id,r.action,r.receipt,r.payload_hash INTO v_player,v_action,v_result,v_hash
 FROM public.multi_day_bag_requests_v1 r WHERE r.request_id=p_request_id
 AND r.flight_tournament_id=p_flight_tournament_id AND r.actor_id=v_actor;
 IF NOT FOUND THEN
   SELECT 'close',r.receipt,NULL::text INTO v_action,v_result,v_hash
   FROM public.multi_day_close_requests_v1 r WHERE r.request_id=p_request_id
   AND r.flight_tournament_id=p_flight_tournament_id AND r.actor_id=v_actor;
 END IF;
 IF v_player IS NOT NULL THEN
   SELECT r.dealer_user_id INTO v_dealer FROM public.multi_day_flight_roster_v1 r
   WHERE r.flight_tournament_id=p_flight_tournament_id AND r.player_id=v_player;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_club AND c.owner_id=v_actor)
   AND NOT public.is_club_chip_master(v_actor,v_club)
   AND NOT (v_action='edit' AND v_dealer IS NOT DISTINCT FROM v_actor) THEN
   RAISE EXCEPTION 'multi_day_receipt_actor_not_allowed' USING ERRCODE='42501';
 END IF;
 IF v_result IS NULL THEN RETURN jsonb_build_object('found',false); END IF;
 RETURN jsonb_build_object('found',true,'actorId',v_actor,'flightTournamentId',p_flight_tournament_id,
   'requestId',p_request_id,'action',v_action,'playerId',v_player,'payloadHash',v_hash,'result',v_result);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_get_bagging_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_get_bagging_receipt_v1(uuid,uuid) TO authenticated;
COMMIT;
