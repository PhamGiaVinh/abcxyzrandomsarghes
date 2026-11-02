-- LOCAL empty-history inverse. Retained payments require forward repair.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM private.multi_day_individual_payment_commits_v1) THEN RAISE EXCEPTION 'individual_payment_history_retained_use_forward_repair';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.get_multi_day_individual_payment_recipients_v1(uuid)'::regprocedure) IS DISTINCT FROM 'f9ce597bf94159c931c1b1c56b7a1005' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.multi_day_individual_payment_context_v1(uuid,uuid)'::regprocedure) IS DISTINCT FROM '4aec0304d5ef8bf07bc0412ef420ac93' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.record_multi_day_individual_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure) IS DISTINCT FROM '2692bcef952775aa244be0548fa458aa' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure) IS DISTINCT FROM '23443a507c50121b7d82bb13bc99aebc' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.is_individual_multi_day_payment_v1(tournament_prize_payments)'::regprocedure) IS DISTINCT FROM '12a3105bdebbe6eff552797f304fccbd' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.is_verified_multi_day_payment_v1(tournament_prize_payments)'::regprocedure) IS DISTINCT FROM '7a154a2c8c0be3a4a0e9b9fbe0edda36' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_individual_payment_state_v1(uuid)'::regprocedure) IS DISTINCT FROM '461dad87754f4de29bede3ca3a7bff59' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_payment_funding_evaluate_v1(uuid,jsonb)'::regprocedure) IS DISTINCT FROM '39aa257a92789176571dcb567e3854f0' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_payment_verified_funding_v1(uuid)'::regprocedure) IS DISTINCT FROM '6410eab105d6d1b7ee19f0cae4c9aceb' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure) IS DISTINCT FROM 'd0a0a1b560c1e726b24839e0166059a3' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure) IS DISTINCT FROM '6cdb8047caf491bd0d0166474ba2521f' THEN RAISE EXCEPTION 'individual_payment_down_body_drift';END IF;
END $guard$;
CREATE OR REPLACE FUNCTION private.is_verified_multi_day_payment_v1(row_value tournament_prize_payments)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT row_value.multi_day_participation_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM private.multi_day_payment_commits_v1 c
  JOIN public.multi_day_final_participations_v1 p ON p.id=c.participation_id
   AND p.event_id=c.event_id AND p.final_tournament_id=c.tournament_id AND p.player_id=c.player_id
  JOIN public.multi_day_payout_finalizations_v1 f ON f.event_id=c.event_id
   AND f.final_tournament_id=c.tournament_id AND f.club_id=c.club_id
  WHERE c.payment_id=row_value.id AND c.transaction_id=pg_catalog.txid_current()
   AND c.backend_pid=pg_catalog.pg_backend_pid() AND c.actor_id=auth.uid()
   AND row_value.multi_day_participation_id=c.participation_id
   AND row_value.tournament_id=c.tournament_id AND row_value.club_id=c.club_id
   AND row_value.finished_place=c.finished_place AND row_value.prize_amount=c.amount_vnd
   AND row_value.recipient_ref=c.player_id AND row_value.recipient_name=c.recipient_name
   AND row_value.paid_by=c.actor_id AND row_value.paid_at=c.paid_at
   AND row_value.method=c.method AND row_value.status='paid'
   AND row_value.proof_url IS NULL AND row_value.notes IS NULL);
$function$
;
CREATE OR REPLACE FUNCTION public.get_multi_day_payout_recipients_v1(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.record_multi_day_prize_payment_v1(p_event_id uuid, p_participation_id uuid, p_method text, p_expected_token text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION private.multi_day_unified_obligation_accounting_v1(p_event_id uuid)
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

DROP FUNCTION floor_private.record_multi_day_individual_payment_v1(uuid,uuid,text,text,uuid);
DROP FUNCTION floor_private.get_multi_day_individual_payment_recipients_v1(uuid);
DROP FUNCTION floor_private.multi_day_individual_payment_context_v1(uuid,uuid);
DROP FUNCTION private.multi_day_individual_payment_state_v1(uuid);
DROP FUNCTION private.is_individual_multi_day_payment_v1(public.tournament_prize_payments);
DROP FUNCTION private.multi_day_payment_verified_funding_v1(uuid);
DROP FUNCTION private.multi_day_payment_funding_evaluate_v1(uuid,jsonb);
DROP TABLE private.multi_day_individual_payment_commits_v1;
