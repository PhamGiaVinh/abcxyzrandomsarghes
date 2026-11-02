-- LOCAL candidate. Link individual debt to global finalization; never sum both.
-- Explicit guarded transaction. No payment writer or historical debt rewrite.
DO $$ BEGIN
 IF to_regclass('private.multi_day_individual_obligations_v1') IS NULL
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure))
  IS DISTINCT FROM '924ff3f29f94d8f962d703d384b46c1b'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure))
  IS DISTINCT FROM 'c14f988d9940615ddfb76774b191ba97'
 THEN RAISE EXCEPTION 'individual_global_liability_dependency_drift';END IF;
END $$;
CREATE FUNCTION private.reconcile_multi_day_individual_obligations_v1(p_event_id uuid,p_obligations jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE obligation private.multi_day_individual_obligations_v1;item jsonb;links jsonb:='[]'::jsonb;
BEGIN
 IF p_obligations IS NULL OR jsonb_typeof(p_obligations)<>'array' THEN RAISE EXCEPTION 'individual_obligation_reconciliation_invalid';END IF;
 FOR obligation IN SELECT * FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id ORDER BY participation_id LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(p_obligations)x WHERE x->>'participationId'=obligation.participation_id::text)<>1
  THEN RAISE EXCEPTION 'individual_obligation_global_identity_changed';END IF;
  SELECT x INTO item FROM jsonb_array_elements(p_obligations)x WHERE x->>'participationId'=obligation.participation_id::text;
  IF item->>'playerId' IS DISTINCT FROM obligation.player_id::text
   OR (item->>'rank')::integer IS DISTINCT FROM obligation.finished_place
   OR (item->>'totalVnd')::numeric IS DISTINCT FROM obligation.amount_vnd
   OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s WHERE s.participation_id=obligation.participation_id
    AND s.entry_id=obligation.entry_id AND s.final_tournament_id=obligation.tournament_id AND s.player_id=obligation.player_id)
  THEN RAISE EXCEPTION 'individual_obligation_global_amount_or_identity_changed';END IF;
  links:=links||jsonb_build_array(jsonb_build_object('participationId',obligation.participation_id,'entryId',obligation.entry_id,
   'individualRequestId',obligation.request_id,'individualActorId',obligation.actor_id,'rank',obligation.finished_place,
   'amountVnd',obligation.amount_vnd,'quoteHash',obligation.quote_hash,'sourceInputHash',obligation.source_input_hash));
 END LOOP;
 RETURN links;
END $$;
REVOKE ALL ON FUNCTION private.reconcile_multi_day_individual_obligations_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.multi_day_unified_obligation_accounting_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE final public.multi_day_payout_finalizations_v1;total numeric;finalized integer;links jsonb;
BEGIN
 SELECT * INTO final FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF FOUND THEN
  links:=private.reconcile_multi_day_individual_obligations_v1(p_event_id,final.obligations);
  RETURN private.multi_day_payout_accounting_v1(p_event_id)||jsonb_build_object('liabilityBasis','GLOBAL',
   'individualObligationLinks',links,'finalizedCount',jsonb_array_length(final.obligations));
 END IF;
 SELECT coalesce(sum(amount_vnd),0),count(*) INTO total,finalized FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id;
 IF finalized=0 THEN RETURN NULL;END IF;
 -- Early paid markers are not implemented by this package. Never report zero
 -- paid if a marker exists without the forthcoming verified early accounting.
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m JOIN public.tournaments t ON t.id=m.tournament_id WHERE t.event_id=p_event_id AND t.phase='final')
 THEN RAISE EXCEPTION 'individual_obligation_early_payment_accounting_not_integrated';END IF;
 IF total>9007199254740991 THEN RAISE EXCEPTION 'multi_day_payout_amount_overflow';END IF;
 RETURN jsonb_build_object('paidPlayerVnd',0,'unpaidObligationVnd',total,'liabilityBasis','INDIVIDUAL','finalizedCount',finalized);
END $$;
REVOKE ALL ON FUNCTION private.multi_day_unified_obligation_accounting_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE fn regprocedure;definition text;acl aclitem[];anchor text;replacement text;
BEGIN
 fn:='public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:=' v_receipt:=pg_catalog.jsonb_build_object(';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_global_finalize_anchor_drift';END IF;
 EXECUTE replace(definition,anchor,$new$ v_preview:=jsonb_set(v_preview,'{sourceSnapshot,individualObligations}',
   private.reconcile_multi_day_individual_obligations_v1(p_event_id,v_preview->'obligations'),true);
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_global_finalize_acl_drift';END IF;
 fn:='public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure;
 SELECT pg_get_functiondef(fn),proacl INTO definition,acl FROM pg_proc WHERE oid=fn;
 anchor:='THEN EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=t.event_id AND f.final_tournament_id=t.id)';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_scope_anchor_drift';END IF;
 definition:=replace(definition,anchor,$new$THEN (EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f WHERE f.event_id=t.event_id AND f.final_tournament_id=t.id)
       OR EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 o WHERE o.event_id=t.event_id AND o.tournament_id=t.id))$new$);
 anchor:='      s.id, s.name, s.close_date, s.is_closed, s.has_finished_place,';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_calc_anchor_drift';END IF;
 definition:=replace(definition,anchor,anchor||chr(10)||'      d.state->>''liabilityBasis'' AS liability_basis,');
 anchor:='      CASE WHEN f.event_id IS NOT NULL THEN'||chr(10)||'       (d.state';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_owed_anchor_drift';END IF;
 definition:=replace(definition,anchor,'      CASE WHEN d.state IS NOT NULL THEN'||chr(10)||'       (d.state');
 anchor:='      CASE WHEN f.event_id IS NOT NULL THEN (d.state';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_paid_anchor_drift';END IF;
 definition:=replace(definition,anchor,'      CASE WHEN d.state IS NOT NULL THEN (d.state');
 anchor:=$old$      (SELECT COUNT(*) FROM public.tournament_entries e
       WHERE e.tournament_id = s.id AND e.finished_place IS NOT NULL) AS finishers_count$old$;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_count_anchor_drift';END IF;
 definition:=replace(definition,anchor,$new$      CASE WHEN d.state->>'liabilityBasis'='INDIVIDUAL' THEN (d.state->>'finalizedCount')::bigint ELSE
       (SELECT COUNT(*) FROM public.tournament_entries e WHERE e.tournament_id=s.id AND e.finished_place IS NOT NULL) END AS finishers_count$new$);
 anchor:='    LEFT JOIN LATERAL (SELECT CASE WHEN f.event_id IS NOT NULL THEN private.multi_day_payout_accounting_v1(f.event_id) ELSE NULL END AS state) d ON true';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_accounting_anchor_drift';END IF;
 replacement:=$new$    LEFT JOIN LATERAL (SELECT CASE WHEN f.event_id IS NOT NULL OR EXISTS(
       SELECT 1 FROM private.multi_day_individual_obligations_v1 o WHERE o.tournament_id=s.id)
       THEN private.multi_day_unified_obligation_accounting_v1((SELECT event_id FROM public.tournaments WHERE id=s.id))
       ELSE NULL END AS state) d ON true$new$;
 definition:=replace(definition,anchor,replacement);
 anchor:='      ''finishersCount'', c.finishers_count';
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_liability_metadata_anchor_drift';END IF;
 definition:=replace(definition,anchor,anchor||','||chr(10)||'      ''liabilityScope'',coalesce(c.liability_basis,''ORDINARY''),''isPartial'',coalesce(c.liability_basis=''INDIVIDUAL'',false)');
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_liability_acl_drift';END IF;
END $patch$;
