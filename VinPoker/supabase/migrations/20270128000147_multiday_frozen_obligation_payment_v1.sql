-- CLI candidate20261018120843, local forward147 NOT LIVE.
-- Operational paid marker only, no bank transfer/reconciliation. Money and
-- recipient derive from finalized participation + approved corrections.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION floor_private.multi_day_payment_context_v1(p_event_id uuid,p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE f public.multi_day_payout_finalizations_v1; state jsonb; item jsonb; original jsonb;
 entry public.tournament_entries; label text; context jsonb; last_payment public.tournament_prize_payments;
BEGIN
 SELECT * INTO f FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_obligations_not_finalized';END IF;
 state:=public.multi_day_payout_postfinal_state_v1(p_event_id);
 SELECT x.value INTO item FROM jsonb_array_elements(state->'obligations') x(value) WHERE x.value->>'participationId'=p_participation_id::text;
 SELECT x.value INTO original FROM jsonb_array_elements(f.obligations) x(value) WHERE x.value->>'participationId'=p_participation_id::text;
 IF item IS NULL OR original IS NULL THEN RAISE EXCEPTION 'multi_day_participation_missing';END IF;
 SELECT e.* INTO entry FROM public.multi_day_final_seatings_v1 s
 JOIN public.multi_day_final_participations_v1 p ON p.id=s.participation_id AND p.event_id=p_event_id
 JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=f.final_tournament_id AND e.player_id=p.player_id
 WHERE s.participation_id=p_participation_id AND p.player_id=(item->>'playerId')::uuid;
 IF NOT FOUND OR entry.finished_place IS DISTINCT FROM (original->>'rank')::integer THEN RAISE EXCEPTION 'multi_day_result_identity_changed';END IF;
 SELECT coalesce(nullif(btrim(r.display_name),''),'Final Day player') INTO label
 FROM public.multi_day_final_seatings_v1 s JOIN public.seat_draw_receipts r ON r.id=s.receipt_id
 WHERE s.participation_id=p_participation_id;
 SELECT * INTO last_payment FROM public.tournament_prize_payments m WHERE m.tournament_id=f.final_tournament_id
  AND m.recipient_ref=entry.player_id AND m.status='paid' ORDER BY m.paid_at DESC,m.id DESC LIMIT 1;
 context:=jsonb_build_object('entryId',entry.id,'recipientRef',entry.player_id,'recipientName',label,
  'tournamentId',f.final_tournament_id,'multiDayEventId',p_event_id,'multiDayParticipationId',p_participation_id,
  'finishedPlace',entry.finished_place,'prizeAmount',(item->>'currentUnpaidVnd')::bigint,
  'obligationAmount',(item->>'currentTotalVnd')::bigint,'paidAmount',(item->>'currentPaidVnd')::bigint,
  'accountingRevision',state->>'revision','isPaid',(item->>'currentUnpaidVnd')::bigint=0,
  'paidAt',last_payment.paid_at,'method',last_payment.method);
 RETURN context||jsonb_build_object('confirmationToken',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION floor_private.multi_day_payment_context_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_multi_day_payout_recipients_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); f public.multi_day_payout_finalizations_v1; state jsonb; item jsonb;
 places jsonb:='[]';context jsonb;paid_count integer:=0;
BEGIN
 SELECT * INTO f FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_obligations_not_finalized';END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=f.club_id AND
  (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501';END IF;
 state:=public.multi_day_payout_postfinal_state_v1(p_event_id);
 FOR item IN SELECT x.value FROM jsonb_array_elements(f.obligations) x(value)
  ORDER BY (x.value->>'rank')::integer,x.value->>'participationId' LOOP
  context:=floor_private.multi_day_payment_context_v1(p_event_id,(item->>'participationId')::uuid);
  IF (context->>'isPaid')::boolean THEN paid_count:=paid_count+1;END IF;
  places:=places||jsonb_build_array(context);
 END LOOP;
 RETURN jsonb_build_object('tournamentId',f.final_tournament_id,'mode','multi_day','eventId',p_event_id,
  'itmPlaces',NULL,'owedTotal',(state->>'paidPlayerVnd')::bigint+(state->>'unpaidObligationVnd')::bigint,
  'paidTotal',(state->>'paidPlayerVnd')::bigint,'paidCount',paid_count,'totalCount',jsonb_array_length(places),'places',places);
END $$;
REVOKE ALL ON FUNCTION public.get_multi_day_payout_recipients_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_multi_day_payout_recipients_v1(uuid) TO authenticated;

CREATE FUNCTION public.record_multi_day_prize_payment_v1(p_event_id uuid,p_participation_id uuid,
 p_method text,p_expected_token text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); f public.multi_day_payout_finalizations_v1;
 context jsonb;payload jsonb;receipt floor_private.payout_payment_receipts_v1;result jsonb;
 payment_id uuid:=gen_random_uuid(); amount bigint;stamp timestamptz;next_revision text;after_state jsonb;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized');END IF;
 IF p_event_id IS NULL OR p_participation_id IS NULL OR p_request_id IS NULL OR p_method IS NULL
  OR p_method NOT IN('cash','bank','app','other') OR p_expected_token IS NULL OR p_expected_token!~'^[a-f0-9]{32}$'
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_payment_intent');END IF;
 SELECT * INTO f FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','multi_day_obligations_not_finalized');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=f.club_id AND
  (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 context:=floor_private.multi_day_payment_context_v1(p_event_id,p_participation_id);
 payload:=jsonb_build_object('tournament_id',f.final_tournament_id,'finished_place',(context->>'finishedPlace')::integer,
  'method',p_method,'expected_token',p_expected_token,'event_id',p_event_id,'participation_id',p_participation_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO receipt FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'error','request_payload_conflict');END IF;
  RETURN receipt.result;
 END IF;
 -- Same event fence as finalization/correction. Re-read context AFTER waiting.
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.clubs WHERE id=f.club_id AND owner_id=actor FOR SHARE;
 IF NOT FOUND THEN
  PERFORM 1 FROM public.club_cashiers WHERE club_id=f.club_id AND user_id=actor FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND g.enabled AND f.club_id=ANY(g.allowed_club_ids))
 THEN RETURN jsonb_build_object('ok',false,'error','multi_day_package_release_off');END IF;
 context:=floor_private.multi_day_payment_context_v1(p_event_id,p_participation_id);
 amount:=(context->>'prizeAmount')::bigint;
 IF context->>'confirmationToken' IS DISTINCT FROM p_expected_token THEN
  result:=jsonb_build_object('ok',false,'error','payout_confirmation_stale');
 ELSIF amount<=0 THEN
  result:=jsonb_build_object('ok',false,'error','no_unpaid_obligation');
 ELSE
  stamp:=clock_timestamp();
  next_revision:=md5(jsonb_build_object('previous',context->>'accountingRevision','payment',payment_id,
   'participation',p_participation_id,'amount',amount,'method',p_method)::text);
  INSERT INTO private.multi_day_payment_commits_v1(payment_id,event_id,participation_id,tournament_id,club_id,actor_id,
   player_id,finished_place,amount_vnd,recipient_name,method,paid_at,transaction_id,backend_pid,previous_revision,resulting_revision)
  VALUES(payment_id,p_event_id,p_participation_id,f.final_tournament_id,f.club_id,actor,
   (context->>'recipientRef')::uuid,(context->>'finishedPlace')::integer,amount,context->>'recipientName',p_method,
   stamp,txid_current(),pg_backend_pid(),context->>'accountingRevision',next_revision);
  INSERT INTO public.tournament_prize_payments(id,tournament_id,club_id,finished_place,prize_amount,
   recipient_ref,recipient_name,status,paid_by,paid_at,method,multi_day_participation_id)
  VALUES(payment_id,f.final_tournament_id,f.club_id,(context->>'finishedPlace')::integer,amount,
   (context->>'recipientRef')::uuid,context->>'recipientName','paid',actor,stamp,p_method,p_participation_id);
  after_state:=public.multi_day_payout_postfinal_state_v1(p_event_id);
  IF after_state->>'revision' IS DISTINCT FROM next_revision THEN RAISE EXCEPTION 'multi_day_payment_accounting_mismatch';END IF;
  result:=jsonb_build_object('ok',true,'outcome','recorded','payment_id',payment_id,'prize_amount',amount,'paid_at',stamp,
   'tournament_id',f.final_tournament_id,'finished_place',(context->>'finishedPlace')::integer,
   'entry_id',context->>'entryId','recipient_ref',context->>'recipientRef','accounting_revision',next_revision);
 END IF;
 INSERT INTO floor_private.payout_payment_receipts_v1(actor_id,request_id,payload,result) VALUES(actor,p_request_id,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid) TO authenticated;

-- Route reads only. Existing generic writers remain held for D2; browser must
-- send the participation identity to the dedicated writer, not a rank alone.
DO $$
DECLARE target regprocedure:='public.get_tournament_payout_recipients(uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),''); acl aclitem[];
 anchor text:=' FOR item IN SELECT DISTINCT e.finished_place';
BEGIN
 SELECT proacl INTO acl FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)<>'9d03dbdfef22bf26f18aa252261238e6'
  OR length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'multiday147_read_route_drift';END IF;
 EXECUTE replace(definition,anchor,$new$ IF tour.phase='final' AND EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 q WHERE q.event_id=tour.event_id) THEN
  RETURN public.get_multi_day_payout_recipients_v1(tour.event_id);
 END IF;
$new$||anchor);
 IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'multiday147_acl_drift';END IF;
END $$;
COMMIT;
