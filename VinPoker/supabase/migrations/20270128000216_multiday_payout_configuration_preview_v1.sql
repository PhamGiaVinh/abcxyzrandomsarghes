-- LOCAL CANDIDATE ONLY. CLI-generated file moved after catalog reservation216.
-- Read-only proposed rank amounts; no prize, obligation, overlay or payment write.
-- The existing public preview keeps its funding/bank/tenant checks unchanged.
-- Recovery: tests/cashier/multiDayPayoutConfiguration.recovery.pg17.sql restores
-- the exact original private evaluator digest before removing the new functions.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$
BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_payout_unverified_v1(uuid)'::regprocedure)
      IS DISTINCT FROM '156dffd08c53e36f216d1240af5cf56f'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_payout_preview_v1(uuid)'::regprocedure)
      IS DISTINCT FROM '391d3632fea66c8b276a478b2d8a168c'
 OR to_regprocedure('private.multi_day_payout_prize_rows_v1(uuid,jsonb)') IS NOT NULL
 OR to_regprocedure('private.multi_day_payout_evaluate_v2(uuid,jsonb)') IS NOT NULL
 OR to_regprocedure('public.multi_day_payout_configuration_preview_v1(uuid,jsonb)') IS NOT NULL THEN
   RAISE EXCEPTION 'multiday216_catalog_drift';
 END IF;
END $$;

CREATE FUNCTION private.multi_day_payout_prize_rows_v1(p_final uuid,p_proposed_rows jsonb)
RETURNS TABLE(tournament_id uuid,"position" integer,amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF p_proposed_rows IS NULL THEN
   RETURN QUERY SELECT q.tournament_id,q.position,q.amount::numeric
     FROM public.tournament_prizes q WHERE q.tournament_id=p_final;
   RETURN;
 END IF;
 IF jsonb_typeof(p_proposed_rows) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'multi_day_payout_proposal_invalid' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_proposed_rows) r(value)
    WHERE jsonb_typeof(r.value) IS DISTINCT FROM 'object'
      OR jsonb_typeof(r.value->'position') IS DISTINCT FROM 'number'
      OR jsonb_typeof(r.value->'amount') IS DISTINCT FROM 'number') THEN
   RAISE EXCEPTION 'multi_day_payout_proposal_invalid' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_proposed_rows) r(value)
    WHERE (r.value->>'position')::numeric NOT BETWEEN 1 AND 2147483647
      OR (r.value->>'position')::numeric<>trunc((r.value->>'position')::numeric)
      OR (r.value->>'amount')::numeric NOT BETWEEN 0 AND 9007199254740991
      OR (r.value->>'amount')::numeric<>trunc((r.value->>'amount')::numeric))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_proposed_rows) r(value)
    GROUP BY (r.value->>'position')::numeric HAVING count(*)>1) THEN
   RAISE EXCEPTION 'multi_day_payout_proposal_invalid' USING ERRCODE='22023';
 END IF;
 RETURN QUERY SELECT p_final,(r.value->>'position')::integer,(r.value->>'amount')::numeric
   FROM jsonb_array_elements(p_proposed_rows) r(value);
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_prize_rows_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE definition text:=replace(pg_get_functiondef('private.multi_day_payout_unverified_v1(uuid)'::regprocedure),chr(13),'');
 source_anchor text:='public.tournament_prizes q';
 validation_anchor text:='PERFORM private.multi_day_payout_validate_positions_v1(v_rules.final_tournament_id);';
BEGIN
 IF (length(definition)-length(replace(definition,source_anchor,'')))/length(source_anchor)<>3
 OR (length(definition)-length(replace(definition,'count(q.id)','')))/length('count(q.id)')<>1
 OR (length(definition)-length(replace(definition,validation_anchor,'')))/length(validation_anchor)<>1 THEN
   RAISE EXCEPTION 'multiday216_evaluator_anchor_drift';
 END IF;
 definition:=replace(definition,'FUNCTION private.multi_day_payout_unverified_v1(p_event_id uuid)',
   'FUNCTION private.multi_day_payout_evaluate_v2(p_event_id uuid, p_proposed_rows jsonb)');
 definition:=replace(definition,source_anchor,'private.multi_day_payout_prize_rows_v1(v_rules.final_tournament_id,p_proposed_rows) q');
 -- Canonical position is nonnull; proposals have no invented database row ID.
 definition:=replace(definition,'count(q.id)','count(q.position)');
 definition:=replace(definition,validation_anchor,
   'IF p_proposed_rows IS NULL THEN '||validation_anchor||' END IF;');
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_evaluate_v2(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.multi_day_payout_unverified_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ BEGIN
 RETURN private.multi_day_payout_evaluate_v2(p_event_id,NULL);
END $$;
REVOKE ALL ON FUNCTION private.multi_day_payout_unverified_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE definition text:=replace(pg_get_functiondef('public.multi_day_payout_preview_v1(uuid)'::regprocedure),chr(13),'');
 call_anchor text:='v_result:=private.multi_day_payout_unverified_v1(p_event_id);';
BEGIN
 IF (length(definition)-length(replace(definition,call_anchor,'')))/length(call_anchor)<>1
 OR (length(definition)-length(replace(definition,'RETURN pg_catalog.jsonb_set','')))/length('RETURN pg_catalog.jsonb_set')<>1 THEN
   RAISE EXCEPTION 'multiday216_preview_anchor_drift';
 END IF;
 definition:=replace(definition,'FUNCTION public.multi_day_payout_preview_v1(p_event_id uuid)',
   'FUNCTION public.multi_day_payout_configuration_preview_v1(p_event_id uuid, p_proposed_rows jsonb)');
 definition:=replace(definition,call_anchor,
   'IF p_proposed_rows IS NULL THEN RAISE EXCEPTION ''multi_day_payout_proposal_required'' USING ERRCODE=''22023''; END IF; '||
   'v_result:=private.multi_day_payout_evaluate_v2(p_event_id,p_proposed_rows);');
 definition:=replace(definition,'RETURN pg_catalog.jsonb_set',
   'RETURN pg_catalog.jsonb_build_object(''previewOnly'',true,''configurationPersistence'',''NOT_PERFORMED'',''paymentExecution'',''NOT_PERFORMED'', '||
   '''configurationRevision'',(SELECT pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY q.position,q.id),''[]''::jsonb)::text) '||
   'FROM public.tournament_prizes q WHERE q.tournament_id=(v_result->>''finalTournamentId'')::uuid))||pg_catalog.jsonb_set');
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_payout_configuration_preview_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_payout_configuration_preview_v1(uuid,jsonb) TO authenticated;
COMMENT ON FUNCTION public.multi_day_payout_configuration_preview_v1(uuid,jsonb)
IS 'Read-only candidate rank amounts evaluated against canonical Main Event funding, results and participation obligations. Does not persist configuration or execute payments.';
COMMIT;
