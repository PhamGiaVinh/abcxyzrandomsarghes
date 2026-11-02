-- LOCAL candidate, follows135; no write/grant changes to bag source tables.
BEGIN;
CREATE FUNCTION public.multi_day_get_bagging_receipt_v2(
 p_flight_tournament_id uuid,p_request_id uuid,p_expected_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_receipt jsonb; v_hash text; v_version integer; v_expected jsonb;
BEGIN
 v_receipt:=public.multi_day_get_bagging_receipt_v1(p_flight_tournament_id,p_request_id);
 IF v_receipt->>'found' IS DISTINCT FROM 'true' THEN RETURN v_receipt; END IF;
 IF jsonb_typeof(p_expected_payload) IS DISTINCT FROM 'object'
   OR p_expected_payload->>'p_flight_tournament_id' IS DISTINCT FROM p_flight_tournament_id::text
 THEN RAISE EXCEPTION 'multi_day_receipt_payload_conflict' USING ERRCODE='23505'; END IF;
 IF v_receipt->>'action'='edit' THEN
   v_expected:=jsonb_build_object('p_flight_tournament_id',p_flight_tournament_id,
     'p_player_id',(p_expected_payload->>'p_player_id')::uuid,
     'p_bag_code',p_expected_payload->>'p_bag_code',
     'p_total_value',(p_expected_payload->>'p_total_value')::bigint,
     'p_expected_revision',(p_expected_payload->>'p_expected_revision')::integer);
   v_hash:=md5(jsonb_build_object('flight',p_flight_tournament_id,
     'player',(p_expected_payload->>'p_player_id')::uuid,'code',p_expected_payload->>'p_bag_code',
     'total',(p_expected_payload->>'p_total_value')::bigint,
     'expectedRevision',(p_expected_payload->>'p_expected_revision')::integer)::text);
 ELSIF v_receipt->>'action'='seal' THEN
   v_expected:=jsonb_build_object('p_flight_tournament_id',p_flight_tournament_id,
     'p_player_id',(p_expected_payload->>'p_player_id')::uuid,
     'p_expected_revision',(p_expected_payload->>'p_expected_revision')::integer);
   v_hash:=md5(jsonb_build_object('flight',p_flight_tournament_id,
     'player',(p_expected_payload->>'p_player_id')::uuid,
     'expectedRevision',(p_expected_payload->>'p_expected_revision')::integer,'action','seal')::text);
 ELSIF v_receipt->>'action'='close' THEN
   SELECT r.expected_day_version INTO v_version FROM public.multi_day_close_requests_v1 r
   WHERE r.request_id=p_request_id AND r.flight_tournament_id=p_flight_tournament_id AND r.actor_id=auth.uid();
   v_expected:=jsonb_build_object('p_flight_tournament_id',p_flight_tournament_id,'p_expected_day_version',v_version);
 ELSE RAISE EXCEPTION 'multi_day_receipt_payload_conflict' USING ERRCODE='23505';
 END IF;
 IF p_expected_payload IS DISTINCT FROM v_expected
   OR (v_receipt->>'action'<>'close' AND v_hash IS DISTINCT FROM v_receipt->>'payloadHash') THEN
   RAISE EXCEPTION 'multi_day_receipt_payload_conflict' USING ERRCODE='23505';
 END IF;
 RETURN v_receipt || jsonb_build_object('payload',v_expected);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_get_bagging_receipt_v2(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_get_bagging_receipt_v2(uuid,uuid,jsonb) TO authenticated;
COMMIT;
