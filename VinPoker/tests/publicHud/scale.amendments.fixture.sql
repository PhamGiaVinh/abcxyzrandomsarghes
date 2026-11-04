-- Disposable synthetic source mutations only. Never part of release migrations.
-- Uses real source triggers and the production projector; no mocked readiness.
CREATE FUNCTION public.fixture_scale_amend_once_v1(p_operation uuid,p_hand_id uuid,p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE intent jsonb; receipt spectator_projection_v2.fixture_source_operations;
 h public.tournament_hands; outcome public.tournament_settlement_outcomes;
 result jsonb; proof jsonb; result_kind boolean:=p_kind LIKE 'result_%';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 IF p_kind NOT IN ('correct','void','restore','verify','revoke','reverify','result_create','result_edit','result_revoke','result_reverify') THEN RAISE EXCEPTION 'invalid_amendment';END IF;
 intent:=jsonb_build_array('amendment',p_hand_id,p_kind);
 INSERT INTO spectator_projection_v2.fixture_source_operations(operation_id,request) VALUES(p_operation,intent) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT receipt FROM spectator_projection_v2.fixture_source_operations WHERE operation_id=p_operation FOR UPDATE;
 IF receipt.request IS DISTINCT FROM intent THEN RAISE EXCEPTION 'fixture_operation_conflict';END IF;
 IF receipt.response IS NOT NULL THEN RETURN receipt.response;END IF;
 SELECT * INTO STRICT h FROM public.tournament_hands WHERE id=p_hand_id FOR UPDATE;
 IF h.tournament_id<>'10000000-0000-4000-8000-000000000001'::uuid OR h.hand_number<>1 OR h.status<>'completed' THEN RAISE EXCEPTION 'fixture_scope_mismatch';END IF;
 IF p_kind='correct' THEN
  UPDATE public.hand_actions SET action_type=CASE WHEN action_type='raise' THEN 'call' ELSE 'raise' END
   WHERE hand_id=h.id AND action_order=3;
  UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id=h.id;
 ELSIF p_kind IN ('void','restore') THEN
  UPDATE public.tournament_hands SET is_voided=(p_kind='void'),source_revision=source_revision+1 WHERE id=h.id;
 ELSIF p_kind='verify' THEN
  proof:=jsonb_build_object('schemaVersion','settlement-outcome-v1','status','verified',
   'pots',jsonb_build_array(jsonb_build_object('winnerIds',jsonb_build_array('30000000-0000-4000-8000-000000000001'))),
   'handRanks',jsonb_build_array(jsonb_build_object('playerId','30000000-0000-4000-8000-000000000001'),jsonb_build_object('playerId','30000000-0000-4000-8000-000000000002')),
   'players',jsonb_build_array(jsonb_build_object('playerId','30000000-0000-4000-8000-000000000001','startingStack',1000,'endingStack',1100,'netDelta',100,'externalDelta',0)));
  INSERT INTO public.tournament_settlement_outcomes(hand_id,source_revision,settlement_revision,status,public_outcome)
   SELECT h.id,h.source_revision,coalesce(max(settlement_revision),0)+1,'verified',proof FROM public.tournament_settlement_outcomes WHERE hand_id=h.id;
 ELSIF p_kind IN ('revoke','reverify') THEN
  SELECT * INTO STRICT outcome FROM public.tournament_settlement_outcomes WHERE hand_id=h.id ORDER BY settlement_revision DESC,id DESC LIMIT 1;
  UPDATE public.tournament_settlement_outcomes SET status=CASE WHEN p_kind='revoke' THEN 'revoked' ELSE 'verified' END,
   settlement_revision=settlement_revision+1 WHERE id=outcome.id;
 ELSIF p_kind='result_create' THEN
  INSERT INTO public.player_results(id,player_id,verified_by_admin,prize,tournament_name,event_date,position,total_entries)
   VALUES(h.id,'30000000-0000-4000-8000-000000000001',true,100,'SYNTHETIC AMENDMENT TEST','2026-01-01',1,2)
   ON CONFLICT(id) DO UPDATE SET verified_by_admin=true,prize=100;
 ELSIF p_kind='result_edit' THEN
  UPDATE public.player_results SET prize=prize+10 WHERE id=h.id;
 ELSE
  UPDATE public.player_results SET verified_by_admin=(p_kind='result_reverify') WHERE id=h.id;
 END IF;
 SELECT * INTO STRICT h FROM public.tournament_hands WHERE id=p_hand_id;
 result:=jsonb_build_object('operation',p_operation,'kind',p_kind,'handId',h.id,'sourceRevision',h.source_revision::text,
  'fingerprint',tracker_analytics_v1.hand_fingerprint(h.id),'expectedContributions',CASE WHEN h.is_voided THEN 0 ELSE 2 END,
  'resultKind',result_kind,'result',(SELECT jsonb_build_object('playerId',r.player_id,'prize',r.prize,'verified',r.verified_by_admin) FROM public.player_results r WHERE r.id=h.id),
  'sourceWrittenAt',clock_timestamp());
 UPDATE spectator_projection_v2.fixture_source_operations SET response=result WHERE operation_id=p_operation;
 RETURN result;
END $$;
CREATE FUNCTION public.fixture_scale_amend_ready_v1(p_operation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; entity uuid; ready boolean; v text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 SELECT response INTO STRICT receipt FROM spectator_projection_v2.fixture_source_operations WHERE operation_id=p_operation;
 IF receipt IS NULL OR receipt->>'kind' IS NULL THEN RAISE EXCEPTION 'fixture_amendment_missing';END IF;
 entity:=(receipt->>'handId')::uuid;
 SELECT version INTO v FROM tracker_analytics_v1.config WHERE singleton;
 IF (receipt->>'resultKind')::boolean THEN
  ready:=NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='result' AND entity_id=entity)
   AND EXISTS(SELECT 1 FROM public.player_results r WHERE r.id=entity AND r.player_id::text=receipt#>>'{result,playerId}' AND r.prize=(receipt#>>'{result,prize}')::bigint AND r.verified_by_admin=(receipt#>>'{result,verified}')::boolean)
   AND CASE WHEN (receipt#>>'{result,verified}')::boolean THEN
    EXISTS(SELECT 1 FROM tracker_analytics_v1.result_contributions c WHERE c.result_id=entity AND c.version=v AND c.player_id::text=receipt#>>'{result,playerId}' AND c.prize=(receipt#>>'{result,prize}')::bigint)
   ELSE NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.result_contributions c WHERE c.result_id=entity AND c.version=v) END;
 ELSE
  ready:=NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=entity)
   AND tracker_analytics_v1.hand_fingerprint(entity)=receipt->>'fingerprint'
   AND (SELECT count(*) FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=entity AND c.version=v)=(receipt->>'expectedContributions')::integer
   AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=entity AND c.version=v AND c.source_fingerprint<>receipt->>'fingerprint');
 END IF;
 RETURN ready;
END $$;
REVOKE ALL ON FUNCTION public.fixture_scale_amend_once_v1(uuid,uuid,text),public.fixture_scale_amend_ready_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_scale_amend_once_v1(uuid,uuid,text),public.fixture_scale_amend_ready_v1(uuid) TO service_role;
