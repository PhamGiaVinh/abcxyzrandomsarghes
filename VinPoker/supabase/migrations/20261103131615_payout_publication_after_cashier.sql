-- CLI generated 20261103131615. New read projections only; no payment/result rewrite.
-- Owner flow: Floor result -> Cashier payment acknowledgement -> public named result.
-- Rollback: restore the captured snapshot RPC definition/grants through a reviewed
-- forward migration; revoke the new Floor read RPC. Never undo payment/receipt rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'payout_publication_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure),chr(13),''))
   IS DISTINCT FROM 'c23a5810b1307994c1b3428958bd92e0' THEN RAISE EXCEPTION 'payout_public_snapshot_drift'; END IF;
 IF to_regprocedure('floor_private.payout_public_rows_after_payment_v1(uuid,jsonb)') IS NOT NULL
 OR to_regprocedure('floor_private.tournament_prize_result_contexts_v1(uuid)') IS NOT NULL
 OR to_regprocedure('public.get_floor_tournament_prize_results_v1(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'payout_publication_catalog_collision'; END IF;
 IF to_regprocedure('floor_private.payout_place_context_v1(uuid,integer)') IS NULL
 OR to_regprocedure('floor_private.floor_table_v3_actor_is_tournament_operator(uuid,uuid)') IS NULL
 OR to_regprocedure('private.multi_day_payout_accounting_v1(uuid)') IS NULL
 OR to_regprocedure('private.multi_day_individual_payment_state_v1(uuid)') IS NULL
 OR to_regclass('private.multi_day_individual_obligations_v1') IS NULL
 OR to_regclass('public.tournament_prize_payments') IS NULL THEN
  RAISE EXCEPTION 'payout_publication_dependency_missing'; END IF;
END $$;

-- Shared current result/obligation proof for the internal Floor and public views.
-- Only the public view masks names until the verified obligation is fully paid.
CREATE FUNCTION floor_private.tournament_prize_result_contexts_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE tour public.tournaments; final public.multi_day_payout_finalizations_v1;
 row record; context jsonb; item jsonb; original jsonb; state jsonb; entry public.tournament_entries;
 payment public.tournament_prize_payments; label text; items jsonb:='[]'; confirmed boolean;
BEGIN
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
 IF tour.phase='final' AND tour.event_id IS NOT NULL THEN
  SELECT * INTO final FROM public.multi_day_payout_finalizations_v1 WHERE event_id=tour.event_id AND final_tournament_id=tour.id;
  IF FOUND THEN
   -- Use the private verified accounting contract: the public postfinal wrapper
   -- intentionally requires an operator and must never be impersonated for anon.
   state:=private.multi_day_payout_accounting_v1(tour.event_id);
   FOR item IN SELECT value FROM jsonb_array_elements(state->'obligations') LOOP
    IF NOT item ?& array['currentTotalVnd','currentPaidVnd','currentUnpaidVnd'] OR
     EXISTS(SELECT 1 FROM jsonb_each(item) x WHERE x.key IN ('currentTotalVnd','currentPaidVnd','currentUnpaidVnd')
      AND (jsonb_typeof(x.value)<>'number' OR (x.value::text)::numeric<>trunc((x.value::text)::numeric) OR (x.value::text)::numeric NOT BETWEEN 0 AND 9007199254740991))
    THEN RAISE EXCEPTION 'multi_day_public_amount_invalid'; END IF;
    SELECT value INTO STRICT original FROM jsonb_array_elements(final.obligations)
      WHERE value->>'participationId'=item->>'participationId';
    SELECT e.* INTO entry FROM public.multi_day_final_seatings_v1 s
      JOIN public.multi_day_final_participations_v1 p ON p.id=s.participation_id AND p.event_id=tour.event_id
      JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=tour.id AND e.player_id=p.player_id
      WHERE s.participation_id=(item->>'participationId')::uuid AND p.player_id=(item->>'playerId')::uuid;
    IF NOT FOUND OR entry.finished_place IS DISTINCT FROM (original->>'rank')::integer THEN
      RAISE EXCEPTION 'multi_day_result_identity_changed'; END IF;
    SELECT coalesce(nullif(btrim(r.display_name),''),'Final Day player') INTO label
      FROM public.multi_day_final_seatings_v1 s JOIN public.seat_draw_receipts r ON r.id=s.receipt_id
      WHERE s.participation_id=(item->>'participationId')::uuid;
    IF label IS NULL THEN RAISE EXCEPTION 'multi_day_result_identity_changed'; END IF;
    items:=items||jsonb_build_array(jsonb_build_object('finishedPlace',entry.finished_place,
      'prizeAmount',(item->>'currentTotalVnd')::numeric::bigint,'recipientName',label,'official',true,
      'paymentConfirmed',(item->>'currentUnpaidVnd')::numeric=0 AND (item->>'currentPaidVnd')::numeric>0));
   END LOOP;
  ELSE
   state:=private.multi_day_individual_payment_state_v1(tour.event_id);
   FOR row IN SELECT * FROM private.multi_day_individual_obligations_v1
     WHERE event_id=tour.event_id AND tournament_id=tour.id ORDER BY finished_place LOOP
    SELECT * INTO entry FROM public.tournament_entries WHERE id=row.entry_id AND tournament_id=tour.id AND player_id=row.player_id;
    IF NOT FOUND OR entry.status<>'busted' OR entry.finished_place IS NOT NULL AND entry.finished_place<>row.finished_place
    THEN RAISE EXCEPTION 'multi_day_result_identity_changed'; END IF;
    SELECT value INTO STRICT item FROM jsonb_array_elements(state->'obligations')
      WHERE value->>'participationId'=row.participation_id::text;
    SELECT coalesce(nullif(btrim(r.display_name),''),'Final Day player') INTO label
      FROM public.multi_day_final_seatings_v1 s JOIN public.seat_draw_receipts r ON r.id=s.receipt_id
      WHERE s.participation_id=row.participation_id AND s.entry_id=row.entry_id
        AND s.player_id=row.player_id AND s.final_tournament_id=tour.id;
    IF label IS NULL OR (item->>'totalVnd')::numeric<>row.amount_vnd THEN RAISE EXCEPTION 'multi_day_result_identity_changed'; END IF;
    items:=items||jsonb_build_array(jsonb_build_object('finishedPlace',row.finished_place,
      'prizeAmount',row.amount_vnd,'recipientName',label,'official',true,
      'paymentConfirmed',(item->>'paidVnd')::numeric=row.amount_vnd AND (item->>'paidVnd')::numeric>0));
   END LOOP;
  END IF;
  RETURN items;
 END IF;
 FOR row IN SELECT position,amount FROM public.tournament_prizes WHERE tournament_id=tour.id ORDER BY position LOOP
  context:=floor_private.payout_place_context_v1(tour.id,row.position);
  IF context->>'ok'='false' AND context->>'error'<>'place_not_finalized' THEN RAISE EXCEPTION '%',context->>'error'; END IF;
  confirmed:=false; payment:=NULL;
  IF context->>'ok'='true' THEN
   SELECT pp.* INTO payment FROM public.tournament_prize_payments pp
    WHERE pp.tournament_id=tour.id AND pp.club_id=tour.club_id AND pp.finished_place=row.position
      AND pp.status='paid' AND pp.recipient_ref=(context->>'recipientRef')::uuid
      AND pp.prize_amount=row.amount AND pp.multi_day_participation_id IS NULL;
   confirmed:=FOUND;
  END IF;
  items:=items||jsonb_build_array(jsonb_build_object('finishedPlace',row.position,'prizeAmount',row.amount,
    'recipientName',CASE WHEN confirmed THEN payment.recipient_name ELSE context->>'recipientName' END,
    'official',context->>'ok'='true','paymentConfirmed',confirmed));
 END LOOP;
 RETURN items;
END $$;
REVOKE ALL ON FUNCTION floor_private.tournament_prize_result_contexts_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION floor_private.payout_public_rows_after_payment_v1(p_tournament_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE context jsonb; items jsonb:='[]'; confirmed boolean;
BEGIN
 FOR context IN SELECT value FROM jsonb_array_elements(floor_private.tournament_prize_result_contexts_v1(p_tournament_id))
   ORDER BY (value->>'finishedPlace')::integer LOOP
  confirmed:=coalesce((context->>'official')::boolean,false) AND coalesce((context->>'paymentConfirmed')::boolean,false);
  items:=items||jsonb_build_array(jsonb_build_object('fromPlace',(context->>'finishedPlace')::integer,
   'toPlace',(context->>'finishedPlace')::integer,'amountPerPlayer',(context->>'prizeAmount')::numeric,
   'playerName',CASE WHEN confirmed THEN context->>'recipientName' END,'avatarUrl',NULL,
   'resultStatus',CASE WHEN confirmed THEN 'official' ELSE 'open' END,'paymentConfirmed',confirmed));
 END LOOP;
 RETURN p_payload||jsonb_build_object('published',jsonb_array_length(items)>0,'items',items);
END $$;
REVOKE ALL ON FUNCTION floor_private.payout_public_rows_after_payment_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Overlay the immutable paid ledger at every public read. Include the masked
-- payload in the revision so a paid acknowledgement invalidates unchanged caches
-- immediately, even when the asynchronous spectator worker has no new publication.
DO $patch$
DECLARE definition text; anchor text;
BEGIN
 definition:=replace(pg_get_functiondef('public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure),chr(13),'');
 anchor:='v_unchanged boolean; BEGIN';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'payout_publication_declaration_anchor'; END IF;
 definition:=replace(definition,anchor,'v_unchanged boolean; v_public_revision text; BEGIN');
 anchor:='    v_unchanged:=COALESCE(p_known_revisions->>v_component,'''')=COALESCE(v_pub.publication_revision::text,''0'')';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'payout_publication_revision_anchor'; END IF;
 definition:=replace(definition,anchor,$replacement$    v_public_revision:=coalesce(v_pub.publication_revision::text,'0');
    IF v_component='payout' THEN
      v_payload:=floor_private.payout_public_rows_after_payment_v1(p_tournament_id,v_payload);
      v_public_revision:=md5(v_public_revision||':'||v_payload::text);
    END IF;
    v_unchanged:=COALESCE(p_known_revisions->>v_component,'')=v_public_revision$replacement$);
 anchor:='''revision'',COALESCE(v_pub.publication_revision::text,''0'')';
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'payout_publication_response_anchor'; END IF;
 definition:=replace(definition,anchor,'''revision'',v_public_revision');
 EXECUTE definition;
END $patch$;

CREATE FUNCTION public.get_floor_tournament_prize_results_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tour public.tournaments; context jsonb; items jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),tour.club_id)
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501'; END IF;
 FOR context IN SELECT value FROM jsonb_array_elements(floor_private.tournament_prize_result_contexts_v1(tour.id))
   ORDER BY (value->>'finishedPlace')::integer LOOP
  items:=items||jsonb_build_array(jsonb_build_object('fromPlace',(context->>'finishedPlace')::integer,
   'toPlace',(context->>'finishedPlace')::integer,'amountPerPlayer',(context->>'prizeAmount')::numeric,
   'playerName',CASE WHEN (context->>'official')::boolean THEN context->>'recipientName' END,
   'avatarUrl',NULL,'resultStatus',CASE WHEN (context->>'official')::boolean THEN 'official' ELSE 'open' END));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'tournamentId',tour.id,'published',jsonb_array_length(items)>0,
  'items',items,'checkedAt',statement_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.get_floor_tournament_prize_results_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_prize_results_v1(uuid) TO authenticated;
DO $$BEGIN
 IF has_function_privilege('anon','public.get_floor_tournament_prize_results_v1(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','floor_private.payout_public_rows_after_payment_v1(uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('anon','public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'payout_publication_acl_failed'; END IF;
END $$;
COMMIT;
