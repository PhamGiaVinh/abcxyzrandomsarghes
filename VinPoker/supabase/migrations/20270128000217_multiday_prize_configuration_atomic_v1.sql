-- LOCAL CANDIDATE, NOT APPLIED. Requires never-retained216 candidate.
-- Owner authors rank amounts only. Does not fund, finalize obligations or pay.
-- Exact inverse tests/cashier/multiDayPrizeConfiguration.recovery.pg17.sql refuses
-- recovery once any configuration history has committed; use forward repair then.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure)
      IS DISTINCT FROM '4dd39985a1a0afca0baf122dfed216d2'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_payout_configuration_preview_v1(uuid,jsonb)'::regprocedure)
      IS DISTINCT FROM '7610ff472c03e70f3bd170ce0b71afd4'
 OR to_regclass('private.multi_day_prize_configurations_v1') IS NOT NULL
 OR to_regclass('private.multi_day_prize_write_intents_v1') IS NOT NULL
 OR to_regprocedure('public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text)') IS NOT NULL THEN
   RAISE EXCEPTION 'multiday217_catalog_drift';
 END IF;
END $$;
CREATE TABLE private.multi_day_prize_configurations_v1(
 actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{32}$'),
 previous_rows jsonb NOT NULL,new_rows jsonb NOT NULL,receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.multi_day_prize_configurations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_prize_configurations_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_prize_configurations_immutable_v1 BEFORE UPDATE OR DELETE
 ON private.multi_day_prize_configurations_v1 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TABLE private.multi_day_prize_write_intents_v1(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('INSERT','DELETE')),row_id uuid NOT NULL,
 row_payload jsonb NOT NULL,PRIMARY KEY(transaction_id,backend_pid,actor_id,operation,row_id)
);
ALTER TABLE private.multi_day_prize_write_intents_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_prize_write_intents_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.consume_multi_day_prize_write_intent_v1(p_operation text,p_row public.tournament_prizes)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE consumed boolean;
BEGIN
 DELETE FROM private.multi_day_prize_write_intents_v1 i
 WHERE i.transaction_id=pg_catalog.txid_current() AND i.backend_pid=pg_catalog.pg_backend_pid()
   AND i.actor_id=auth.uid() AND i.operation=p_operation AND i.row_id=p_row.id
   AND i.row_payload=pg_catalog.to_jsonb(p_row)
 RETURNING true INTO consumed;
 RETURN coalesce(consumed,false);
END $$;
REVOKE ALL ON FUNCTION private.consume_multi_day_prize_write_intent_v1(text,public.tournament_prizes) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE definition text:=replace(pg_get_functiondef('private.multi_day_legacy_payout_hold_v1()'::regprocedure),chr(13),'');
BEGIN
 IF (length(definition)-length(replace(definition,E'BEGIN\n','')))/length(E'BEGIN\n')<>1 THEN RAISE EXCEPTION 'multiday217_guard_anchor_drift';END IF;
 EXECUTE replace(definition,E'BEGIN\n',$new$BEGIN
 IF TG_TABLE_NAME='tournament_prizes' AND TG_OP IN('INSERT','DELETE') THEN
   IF private.consume_multi_day_prize_write_intent_v1(TG_OP,CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END) THEN
     RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
   END IF;
 END IF;
$new$);
END $$;

CREATE FUNCTION public.multi_day_save_prize_configuration_v1(
 p_event_id uuid,p_rows jsonb,p_expected_configuration_revision text,
 p_expected_rules_version text,p_expected_funding_revision text,p_expected_qualification_revision text,
 p_expected_payout_input_hash text,p_request_id uuid,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); event public.tournament_events%ROWTYPE;
 final public.tournaments%ROWTYPE; prior private.multi_day_prize_configurations_v1%ROWTYPE;
 canonical jsonb; request_payload jsonb; request_hash text; before_rows jsonb; after_rows jsonb; preview jsonb; receipt jsonb;
 row public.tournament_prizes%ROWTYPE; proposed record; total numeric; row_count integer; expected_final uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'multi_day_configuration_actor_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO event FROM public.tournament_events WHERE id=p_event_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=event.club_id AND c.owner_id=actor) THEN
   RAISE EXCEPTION 'multi_day_configuration_actor_denied' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason))=0
   OR p_expected_configuration_revision IS NULL OR p_expected_configuration_revision !~ '^[0-9a-f]{32}$'
   OR p_expected_rules_version IS NULL OR p_expected_rules_version !~ '^[0-9a-f]{32}$'
   OR p_expected_funding_revision IS NULL OR p_expected_funding_revision !~ '^[0-9a-f]{32}$'
   OR p_expected_qualification_revision IS NULL OR p_expected_qualification_revision !~ '^[0-9a-f]{32}$'
   OR p_expected_payout_input_hash IS NULL OR p_expected_payout_input_hash !~ '^[0-9a-f]{32}$'
   OR p_rows IS NULL THEN RAISE EXCEPTION 'multi_day_configuration_invalid_request' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('position',q.position,'amount',q.amount) ORDER BY q.position),count(*),sum(q.amount)
 INTO canonical,row_count,total FROM private.multi_day_payout_prize_rows_v1(event.final_tournament_id,p_rows) q;
 IF row_count=0 OR EXISTS(SELECT 1 FROM(
   SELECT q.position,q.amount,row_number() OVER(ORDER BY q.position) n,lag(q.amount) OVER(ORDER BY q.position) previous
   FROM private.multi_day_payout_prize_rows_v1(event.final_tournament_id,p_rows) q) x
   WHERE x.position<>x.n OR x.amount>9999999999.99 OR x.amount>x.previous) THEN
   RAISE EXCEPTION 'multi_day_configuration_rows_invalid' USING ERRCODE='23514';
 END IF;
 request_payload:=jsonb_build_object('event',p_event_id,'rows',canonical,'configuration',p_expected_configuration_revision,
  'rules',p_expected_rules_version,'funding',p_expected_funding_revision,'qualification',p_expected_qualification_revision,
  'proposal',p_expected_payout_input_hash,'reason',btrim(p_reason));
 request_hash:=md5(request_payload::text);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM private.multi_day_prize_configurations_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.request_hash<>request_hash THEN RAISE EXCEPTION 'multi_day_configuration_idempotency_conflict' USING ERRCODE='23505';END IF;
   RETURN prior.receipt||jsonb_build_object('idempotent',true);
 END IF;
 -- Match the old tournament-first writer without blocking Finalize's FK KEY SHARE.
 expected_final:=event.final_tournament_id;
 SELECT * INTO final FROM public.tournaments WHERE id=expected_final FOR NO KEY UPDATE;
 SELECT * INTO event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF final.id IS NULL OR final.id IS DISTINCT FROM event.final_tournament_id OR final.event_id IS DISTINCT FROM p_event_id
  OR final.club_id IS DISTINCT FROM event.club_id OR final.phase IS DISTINCT FROM 'final' OR final.status IS DISTINCT FROM 'completed'
  OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=event.club_id AND c.owner_id=actor) THEN
   RAISE EXCEPTION 'multi_day_configuration_source_changed' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=p_event_id)
  OR EXISTS(SELECT 1 FROM public.tournament_prize_payments m WHERE m.tournament_id=final.id) THEN
   RAISE EXCEPTION 'multi_day_configuration_already_finalized_or_paid' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb) INTO before_rows
 FROM public.tournament_prizes q WHERE q.tournament_id=final.id;
 IF md5(before_rows::text)<>p_expected_configuration_revision THEN
   RAISE EXCEPTION 'multi_day_configuration_stale' USING ERRCODE='40001';END IF;
 preview:=public.multi_day_payout_configuration_preview_v1(p_event_id,canonical);
 IF (preview->>'itmPlaces')::integer<>row_count OR preview->>'rulesVersion'<>p_expected_rules_version
  OR preview->>'fundingRevision'<>p_expected_funding_revision OR preview->>'qualificationRevision'<>p_expected_qualification_revision
  OR preview->>'payoutInputHash'<>p_expected_payout_input_hash THEN
   RAISE EXCEPTION 'multi_day_configuration_source_changed' USING ERRCODE='40001';END IF;
 FOR row IN SELECT * FROM public.tournament_prizes q WHERE q.tournament_id=final.id ORDER BY q.position,q.id LOOP
   INSERT INTO private.multi_day_prize_write_intents_v1 VALUES(txid_current(),pg_backend_pid(),actor,'DELETE',row.id,to_jsonb(row));
   DELETE FROM public.tournament_prizes WHERE id=row.id;
 END LOOP;
 FOR proposed IN SELECT * FROM private.multi_day_payout_prize_rows_v1(final.id,canonical) ORDER BY "position" LOOP
   row.id:=gen_random_uuid();row.tournament_id:=final.id;row.position:=proposed.position;
   row.amount:=proposed.amount;row.percentage:=CASE WHEN total=0 THEN 0 ELSE round(proposed.amount/total*100,2) END;
   row.created_at:=clock_timestamp();
   INSERT INTO private.multi_day_prize_write_intents_v1 VALUES(txid_current(),pg_backend_pid(),actor,'INSERT',row.id,to_jsonb(row));
   INSERT INTO public.tournament_prizes SELECT (row).*;
 END LOOP;
 IF EXISTS(SELECT 1 FROM private.multi_day_prize_write_intents_v1 i WHERE i.transaction_id=txid_current() AND i.backend_pid=pg_backend_pid() AND i.actor_id=actor) THEN
   RAISE EXCEPTION 'multi_day_configuration_intent_not_consumed' USING ERRCODE='23514';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.position,q.id),'[]'::jsonb) INTO after_rows
 FROM public.tournament_prizes q WHERE q.tournament_id=final.id;
 receipt:=jsonb_build_object('ok',true,'idempotent',false,'state','CONFIGURED','eventId',p_event_id,'requestId',p_request_id,
   'configurationRevision',md5(after_rows::text),'previousConfigurationRevision',p_expected_configuration_revision,
   'payoutInputHash',p_expected_payout_input_hash,'requestPayload',request_payload,'requiredShortfallVnd',preview->'requiredShortfallVnd',
   'paymentExecution','NOT_PERFORMED','fundingExecution','NOT_PERFORMED','obligationFinalization','NOT_PERFORMED');
 INSERT INTO private.multi_day_prize_configurations_v1(actor_id,request_id,event_id,tournament_id,request_hash,previous_rows,new_rows,receipt)
 VALUES(actor,p_request_id,p_event_id,final.id,request_hash,before_rows,after_rows,receipt);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_save_prize_configuration_v1(uuid,jsonb,text,text,text,text,text,uuid,text) TO authenticated;
CREATE FUNCTION public.multi_day_prize_configuration_receipt_v1(p_event_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_events e JOIN public.clubs c ON c.id=e.club_id
   WHERE e.id=p_event_id AND c.owner_id=auth.uid()) THEN
   RAISE EXCEPTION 'multi_day_configuration_actor_denied' USING ERRCODE='42501';END IF;
 SELECT receipt INTO result FROM private.multi_day_prize_configurations_v1
 WHERE actor_id=auth.uid() AND event_id=p_event_id AND request_id=p_request_id;
 RETURN coalesce(result,jsonb_build_object('ok',true,'state','NOT_FOUND','eventId',p_event_id,'requestId',p_request_id));
END $$;
REVOKE ALL ON FUNCTION public.multi_day_prize_configuration_receipt_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_prize_configuration_receipt_v1(uuid,uuid) TO authenticated;
COMMIT;
