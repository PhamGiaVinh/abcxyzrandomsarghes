-- LOCAL candidate only. Transaction-bound early paid markers; no bank transfer.
-- Requires1162/1164/1165/1166/1167/1168 in the same guarded transaction.
DO $$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure)) IS DISTINCT FROM '5addc8c68b15fb44b14cd5199c6a404d'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure)) IS DISTINCT FROM '6bf6ef281658df191077a369808abf18'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure)) IS DISTINCT FROM '246185b8b596815a5a3bd074fc03e26d'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure)) IS DISTINCT FROM '1c6d399ff2023e862fa3ca794cc87be9'
 OR to_regclass('private.multi_day_individual_payment_commits_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'individual_payment_dependency_drift';END IF;
END $$;
-- Payment-authorized Cashier uses the same incoming-source computation privately.
-- Public funding preview/obligation confirmation roles remain unchanged.
DO $build$
DECLARE definition text;needle text:='(c.owner_id=v_actor OR public.is_club_floor(v_actor,v_rules.club_id))';
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure)) IS DISTINCT FROM '7ecfb3f082c03267ed728e9cb0648583'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_verified_funding_source_v1(uuid)'::regprocedure)) IS DISTINCT FROM '99ce1551b75923a53fb9ac123a8db23b'
 THEN RAISE EXCEPTION 'individual_payment_funding_dependency_drift';END IF;
 definition:=pg_get_functiondef('private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure);
 IF array_length(string_to_array(definition,needle),1)<>2 THEN RAISE EXCEPTION 'individual_payment_funding_actor_anchor_drift';END IF;
 definition:=replace(definition,'FUNCTION private.multi_day_funding_evaluate_v1(','FUNCTION private.multi_day_payment_funding_evaluate_v1(');
 definition:=replace(definition,needle,'(c.owner_id=v_actor OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=v_rules.club_id AND cc.user_id=v_actor))');
 EXECUTE definition;
 definition:=pg_get_functiondef('private.multi_day_verified_funding_source_v1(uuid)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.multi_day_verified_funding_source_v1(','FUNCTION private.multi_day_payment_verified_funding_v1(');
 definition:=replace(definition,'private.multi_day_funding_evaluate_v1(p_event_id,NULL)','private.multi_day_payment_funding_evaluate_v1(p_event_id,NULL)');
 EXECUTE definition;
END $build$;
REVOKE ALL ON FUNCTION private.multi_day_payment_funding_evaluate_v1(uuid,jsonb),private.multi_day_payment_verified_funding_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.multi_day_individual_payment_commits_v1(
 payment_id uuid PRIMARY KEY REFERENCES public.tournament_prize_payments(id) DEFERRABLE INITIALLY DEFERRED,
 participation_id uuid NOT NULL UNIQUE REFERENCES private.multi_day_individual_obligations_v1(participation_id),
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),actor_id uuid NOT NULL REFERENCES auth.users(id),request_id uuid NOT NULL,
 player_id uuid NOT NULL,finished_place integer NOT NULL CHECK(finished_place>1),
 amount_vnd bigint NOT NULL CHECK(amount_vnd>0 AND amount_vnd<=9007199254740991),
 recipient_name text NOT NULL CHECK(length(btrim(recipient_name))>0),method text NOT NULL CHECK(method IN('cash','bank','app','other')),
 paid_at timestamptz NOT NULL,transaction_id bigint NOT NULL,backend_pid integer NOT NULL,
 previous_revision text NOT NULL CHECK(previous_revision~'^[0-9a-f]{32}$'),UNIQUE(actor_id,request_id),
 FOREIGN KEY(actor_id,request_id) REFERENCES floor_private.payout_payment_receipts_v1(actor_id,request_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE private.multi_day_individual_payment_commits_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_individual_payment_commits_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER individual_payment_commit_immutable BEFORE UPDATE OR DELETE ON private.multi_day_individual_payment_commits_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE FUNCTION private.is_individual_multi_day_payment_v1(row_value public.tournament_prize_payments)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT row_value.multi_day_participation_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM private.multi_day_individual_payment_commits_v1 c
  JOIN private.multi_day_individual_obligations_v1 o ON o.participation_id=c.participation_id AND o.event_id=c.event_id
   AND o.tournament_id=c.tournament_id AND o.player_id=c.player_id AND o.finished_place=c.finished_place AND o.amount_vnd=c.amount_vnd
  JOIN public.multi_day_final_participations_v1 p ON p.id=c.participation_id AND p.event_id=c.event_id
   AND p.final_tournament_id=c.tournament_id AND p.player_id=c.player_id
  JOIN public.tournaments t ON t.id=c.tournament_id AND t.event_id=c.event_id AND t.club_id=c.club_id AND t.phase='final'
  WHERE c.payment_id=row_value.id AND row_value.multi_day_participation_id=c.participation_id
   AND row_value.tournament_id=c.tournament_id AND row_value.club_id=c.club_id
   AND row_value.finished_place=c.finished_place AND row_value.prize_amount=c.amount_vnd
   AND row_value.recipient_ref=c.player_id AND row_value.recipient_name=c.recipient_name
   AND row_value.paid_by=c.actor_id AND row_value.paid_at=c.paid_at AND row_value.method=c.method
   AND row_value.status='paid' AND row_value.proof_url IS NULL AND row_value.notes IS NULL);
$$;
REVOKE ALL ON FUNCTION private.is_individual_multi_day_payment_v1(public.tournament_prize_payments) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text:=pg_get_functiondef('private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure);
 needle text:=' SELECT row_value.multi_day_participation_id IS NOT NULL AND EXISTS(';
BEGIN
 IF array_length(string_to_array(definition,needle),1)<>2 THEN RAISE EXCEPTION 'individual_payment_verifier_anchor_drift';END IF;
 EXECUTE replace(definition,needle,$new$ SELECT (private.is_individual_multi_day_payment_v1(row_value) AND EXISTS(
  SELECT 1 FROM private.multi_day_individual_payment_commits_v1 c WHERE c.payment_id=row_value.id
   AND c.transaction_id=pg_catalog.txid_current() AND c.backend_pid=pg_catalog.pg_backend_pid() AND c.actor_id=auth.uid()))
 OR row_value.multi_day_participation_id IS NOT NULL AND EXISTS($new$);
END $patch$;
CREATE FUNCTION private.multi_day_individual_payment_state_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE tour uuid;rows jsonb;owed numeric;paid numeric;context jsonb;
BEGIN
 SELECT final_tournament_id INTO tour FROM public.tournament_events WHERE id=p_event_id;
 IF tour IS NULL OR EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
 THEN RAISE EXCEPTION 'individual_payment_state_requires_pre_global_event';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m WHERE m.tournament_id=tour AND NOT private.is_individual_multi_day_payment_v1(m))
 THEN RAISE EXCEPTION 'individual_payment_unrecognized_marker';END IF;
 SELECT coalesce(sum(o.amount_vnd),0),coalesce(sum(m.prize_amount),0),coalesce(jsonb_agg(jsonb_build_object(
  'participationId',o.participation_id,'totalVnd',o.amount_vnd,'paidVnd',coalesce(m.prize_amount,0),
  'payment',CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END) ORDER BY o.participation_id),'[]'::jsonb)
 INTO owed,paid,rows FROM private.multi_day_individual_obligations_v1 o LEFT JOIN public.tournament_prize_payments m
  ON m.multi_day_participation_id=o.participation_id AND m.tournament_id=o.tournament_id AND m.status='paid' WHERE o.event_id=p_event_id;
 IF paid>owed OR greatest(owed,paid)>9007199254740991 THEN RAISE EXCEPTION 'individual_payment_amount_invalid';END IF;
 context:=jsonb_build_object('eventId',p_event_id,'obligations',rows,'paidPlayerVnd',paid::bigint,'unpaidObligationVnd',(owed-paid)::bigint);
 RETURN context||jsonb_build_object('revision',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION private.multi_day_individual_payment_state_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.multi_day_individual_payment_context_v1(p_event_id uuid,p_participation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE o private.multi_day_individual_obligations_v1;entry public.tournament_entries;context jsonb;state jsonb;
 funding jsonb;budget jsonb;item jsonb;label text;last_payment public.tournament_prize_payments;
BEGIN
 SELECT * INTO o FROM private.multi_day_individual_obligations_v1 WHERE participation_id=p_participation_id AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'individual_payment_obligation_required';END IF;
 SELECT * INTO entry FROM public.tournament_entries WHERE id=o.entry_id AND tournament_id=o.tournament_id AND player_id=o.player_id;
 IF NOT FOUND OR entry.status<>'busted' OR entry.finished_place IS NOT NULL AND entry.finished_place<>o.finished_place
 THEN RAISE EXCEPTION 'multi_day_result_identity_changed';END IF;
 funding:=private.multi_day_payment_verified_funding_v1(p_event_id);
 budget:=private.multi_day_individual_obligation_budget_v1(p_event_id,funding);
 IF (budget->>'requiredShortfallVnd')::numeric<>0 THEN RAISE EXCEPTION 'individual_payment_shortfall_unfunded';END IF;
 state:=private.multi_day_individual_payment_state_v1(p_event_id);
 SELECT x INTO STRICT item FROM jsonb_array_elements(state->'obligations')x WHERE x->>'participationId'=p_participation_id::text;
 SELECT coalesce(nullif(btrim(r.display_name),''),'Final Day player') INTO label
 FROM public.multi_day_final_seatings_v1 s JOIN public.seat_draw_receipts r ON r.id=s.receipt_id
 WHERE s.participation_id=p_participation_id AND s.entry_id=o.entry_id AND s.player_id=o.player_id AND s.final_tournament_id=o.tournament_id;
 IF label IS NULL THEN RAISE EXCEPTION 'multi_day_result_identity_changed';END IF;
 SELECT * INTO last_payment FROM public.tournament_prize_payments WHERE tournament_id=o.tournament_id AND multi_day_participation_id=p_participation_id AND status='paid';
 context:=jsonb_build_object('entryId',o.entry_id,'recipientRef',o.player_id,'recipientName',label,'tournamentId',o.tournament_id,
  'multiDayEventId',p_event_id,'multiDayParticipationId',p_participation_id,'finishedPlace',o.finished_place,
  'prizeAmount',o.amount_vnd-(item->>'paidVnd')::numeric::bigint,'obligationAmount',o.amount_vnd,'paidAmount',(item->>'paidVnd')::numeric::bigint,
  'accountingRevision',state->>'revision','sourceInputHash',funding->>'sourceInputHash','budgetHash',budget->>'budgetHash',
  'isPaid',o.amount_vnd=(item->>'paidVnd')::numeric::bigint,'paidAt',last_payment.paid_at,'method',last_payment.method);
 RETURN context||jsonb_build_object('confirmationToken',md5(context::text));
END $$;
REVOKE ALL ON FUNCTION floor_private.multi_day_individual_payment_context_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.get_multi_day_individual_payment_recipients_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();club uuid;tour uuid;state jsonb;o record;context jsonb;places jsonb:='[]';paid_count integer:=0;
BEGIN
 SELECT club_id,final_tournament_id INTO club,tour FROM public.tournament_events WHERE id=p_event_id;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND (c.owner_id=actor
  OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501';END IF;
 state:=private.multi_day_individual_payment_state_v1(p_event_id);
 FOR o IN SELECT participation_id FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id ORDER BY finished_place,participation_id LOOP
  context:=floor_private.multi_day_individual_payment_context_v1(p_event_id,o.participation_id);
  places:=places||jsonb_build_array(context);IF (context->>'isPaid')::boolean THEN paid_count:=paid_count+1;END IF;
 END LOOP;
 RETURN jsonb_build_object('tournamentId',tour,'mode','multi_day','eventId',p_event_id,'liabilityScope','INDIVIDUAL','isPartial',true,
  'itmPlaces',NULL,'owedTotal',(state->>'paidPlayerVnd')::bigint+(state->>'unpaidObligationVnd')::bigint,
  'paidTotal',(state->>'paidPlayerVnd')::bigint,'paidCount',paid_count,'totalCount',jsonb_array_length(places),'places',places);
END $$;
REVOKE ALL ON FUNCTION floor_private.get_multi_day_individual_payment_recipients_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION floor_private.record_multi_day_individual_payment_v1(p_event_id uuid,p_participation_id uuid,p_method text,p_expected_token text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();o private.multi_day_individual_obligations_v1;club uuid;context jsonb;payload jsonb;
 receipt floor_private.payout_payment_receipts_v1;result jsonb;amount bigint;payment_id uuid:=gen_random_uuid();stamp timestamptz;after_state jsonb;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized');END IF;
 IF p_request_id IS NULL OR p_method IS NULL OR p_method NOT IN('cash','bank','app','other') OR p_expected_token IS NULL OR p_expected_token!~'^[a-f0-9]{32}$'
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_payment_intent');END IF;
 SELECT * INTO o FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id AND participation_id=p_participation_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','multi_day_obligations_not_finalized');END IF;
 SELECT club_id INTO club FROM public.tournament_events WHERE id=p_event_id AND final_tournament_id=o.tournament_id;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND (c.owner_id=actor
  OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 payload:=jsonb_build_object('tournament_id',o.tournament_id,'finished_place',o.finished_place,'method',p_method,
  'expected_token',p_expected_token,'event_id',p_event_id,'participation_id',p_participation_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO receipt FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'error','request_payload_conflict');END IF;
  RETURN receipt.result;
 END IF;
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 PERFORM 1 FROM public.clubs WHERE id=club AND owner_id=actor FOR SHARE;
 IF NOT FOUND THEN
  PERFORM 1 FROM public.club_cashiers WHERE club_id=club AND user_id=actor FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 WHERE id AND enabled AND club=ANY(allowed_club_ids))
 THEN RETURN jsonb_build_object('ok',false,'error','multi_day_package_release_off');END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id) THEN
  result:=jsonb_build_object('ok',false,'error','payout_confirmation_stale');
 ELSE
  context:=floor_private.multi_day_individual_payment_context_v1(p_event_id,p_participation_id);amount:=(context->>'prizeAmount')::bigint;
  IF context->>'confirmationToken' IS DISTINCT FROM p_expected_token THEN result:=jsonb_build_object('ok',false,'error','payout_confirmation_stale');
  ELSIF amount<=0 THEN result:=jsonb_build_object('ok',false,'error','no_unpaid_obligation');
  ELSE
   stamp:=clock_timestamp();
   INSERT INTO private.multi_day_individual_payment_commits_v1(payment_id,participation_id,event_id,tournament_id,club_id,actor_id,request_id,
    player_id,finished_place,amount_vnd,recipient_name,method,paid_at,transaction_id,backend_pid,previous_revision)
   VALUES(payment_id,p_participation_id,p_event_id,o.tournament_id,club,actor,p_request_id,o.player_id,o.finished_place,amount,
    context->>'recipientName',p_method,stamp,txid_current(),pg_backend_pid(),context->>'accountingRevision');
   INSERT INTO public.tournament_prize_payments(id,tournament_id,club_id,finished_place,prize_amount,recipient_ref,recipient_name,status,paid_by,paid_at,method,multi_day_participation_id)
   VALUES(payment_id,o.tournament_id,club,o.finished_place,amount,o.player_id,context->>'recipientName','paid',actor,stamp,p_method,p_participation_id);
   after_state:=private.multi_day_individual_payment_state_v1(p_event_id);
   IF (after_state->>'paidPlayerVnd')::bigint<>(SELECT coalesce(sum(prize_amount),0) FROM public.tournament_prize_payments WHERE tournament_id=o.tournament_id AND status='paid')
   THEN RAISE EXCEPTION 'individual_payment_accounting_mismatch';END IF;
   result:=jsonb_build_object('ok',true,'outcome','recorded','payment_id',payment_id,'prize_amount',amount,'paid_at',stamp,
    'tournament_id',o.tournament_id,'finished_place',o.finished_place,'entry_id',o.entry_id,'recipient_ref',o.player_id,'accounting_revision',after_state->>'revision');
  END IF;
 END IF;
 INSERT INTO floor_private.payout_payment_receipts_v1(actor_id,request_id,payload,result) VALUES(actor,p_request_id,payload,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION floor_private.record_multi_day_individual_payment_v1(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE definition text;target regprocedure;acl aclitem[];anchor text:=' SELECT * INTO f FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id;';
BEGIN
 FOREACH target IN ARRAY ARRAY['public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure,'public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure] LOOP
  SELECT proacl INTO acl FROM pg_proc WHERE oid=target;definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_payment_public_anchor_drift';END IF;
  IF target='public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure THEN
   definition:=replace(definition,anchor,$new$ IF NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
    AND EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id) THEN
    RETURN floor_private.get_multi_day_individual_payment_recipients_v1(p_event_id);
   END IF;
$new$||anchor);
  ELSE
   definition:=replace(definition,anchor,$new$ IF NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=p_event_id)
    AND EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 WHERE event_id=p_event_id AND participation_id=p_participation_id) THEN
    RETURN floor_private.record_multi_day_individual_payment_v1(p_event_id,p_participation_id,p_method,p_expected_token,p_request_id);
   END IF;
$new$||anchor);
  END IF;
  EXECUTE definition;IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'individual_payment_public_acl_drift';END IF;
 END LOOP;
 target:='private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure;definition:=pg_get_functiondef(target);
 anchor:=$old$ IF EXISTS(SELECT 1 FROM public.tournament_prize_payments m JOIN public.tournaments t ON t.id=m.tournament_id WHERE t.event_id=p_event_id AND t.phase='final')
 THEN RAISE EXCEPTION 'individual_obligation_early_payment_accounting_not_integrated';END IF;$old$;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'individual_payment_accounting_anchor_drift';END IF;
 definition:=replace(definition,anchor,'');
 IF array_length(string_to_array(definition,$old$'paidPlayerVnd',0,'unpaidObligationVnd',total$old$),1)<>2 THEN RAISE EXCEPTION 'individual_payment_accounting_value_anchor_drift';END IF;
 definition:=replace(definition,$old$'paidPlayerVnd',0,'unpaidObligationVnd',total$old$,
  $new$'paidPlayerVnd',(private.multi_day_individual_payment_state_v1(p_event_id)->>'paidPlayerVnd')::bigint,
   'unpaidObligationVnd',(private.multi_day_individual_payment_state_v1(p_event_id)->>'unpaidObligationVnd')::bigint$new$);
 EXECUTE definition;
END $patch$;
