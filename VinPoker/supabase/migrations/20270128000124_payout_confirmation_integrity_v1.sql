-- SOURCE/LOCAL ONLY. CLI generated 20261016212959; forward catalog slot124.
-- One canonical place/recipient derivation, confirmation CAS and actor/key receipts.
-- No repricing, reranking, bank transfer or ledger update/delete.
-- Recovery: restore captured legacy writer definition/grants in a reviewed forward
-- migration; revoke v2/read entrypoints. Preserve payments and receipt audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'payout124_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.record_tournament_prize_payment(uuid,integer,text,text,text)'::regprocedure),chr(13),''))
   <>'a0577fcca58d4f12d342e54f8981a5a8' THEN RAISE EXCEPTION 'payout124_writer_drift'; END IF;
 IF to_regprocedure('public.get_tournament_payout_recipients(uuid)') IS NOT NULL
 OR to_regprocedure('public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid)') IS NOT NULL
 OR to_regclass('floor_private.payout_payment_receipts_v1') IS NOT NULL
 THEN RAISE EXCEPTION 'payout124_catalog_collision'; END IF;
END;
$preflight$;

CREATE TABLE floor_private.payout_payment_receipts_v1 (
 actor_id uuid NOT NULL,
 request_id uuid NOT NULL,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE floor_private.payout_payment_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.payout_payment_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION floor_private.payout_place_context_v1(p_tournament_id uuid,p_finished_place integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 item public.tournament_entries; amount numeric; recipient uuid; name text;
 context jsonb; n bigint;
BEGIN
 SELECT count(*) INTO n FROM public.tournament_entries
 WHERE tournament_id=p_tournament_id AND finished_place=p_finished_place;
 IF n=0 THEN RETURN jsonb_build_object('ok',false,'error','place_not_finalized'); END IF;
 IF n<>1 THEN RETURN jsonb_build_object('ok',false,'error','place_ambiguous'); END IF;
 SELECT * INTO STRICT item FROM public.tournament_entries
 WHERE tournament_id=p_tournament_id AND finished_place=p_finished_place;
 SELECT count(*),min(tp.amount) INTO n,amount FROM public.tournament_prizes tp
 WHERE tp.tournament_id=p_tournament_id AND tp.position=p_finished_place;
 IF n=0 THEN RETURN jsonb_build_object('ok',false,'error','place_not_in_money'); END IF;
 IF n<>1 OR amount IS NULL OR amount<0 THEN RETURN jsonb_build_object('ok',false,'error','prize_invalid'); END IF;
 recipient:=COALESCE(item.member_id,item.player_id);
 IF recipient IS NULL THEN RETURN jsonb_build_object('ok',false,'error','recipient_missing'); END IF;
 SELECT COALESCE((SELECT cm.full_name FROM public.club_members cm WHERE cm.id=item.member_id),
   (SELECT p.display_name FROM public.profiles p WHERE p.user_id=item.player_id),'Khách') INTO name;
 context:=jsonb_build_object('entryId',item.id,'recipientRef',recipient,'recipientName',name,
   'finishedPlace',p_finished_place,'prizeAmount',amount,'tournamentId',p_tournament_id);
 RETURN context||jsonb_build_object('ok',true,'confirmationToken',md5(context::text));
END;
$$;
REVOKE ALL ON FUNCTION floor_private.payout_place_context_v1(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_tournament_payout_recipients(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tour public.tournaments; item record; place jsonb; payment public.tournament_prize_payments;
 places jsonb:='[]'; owed numeric:=0; paid numeric:=0; paid_count integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'tournament_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=tour.club_id AND
   (c.owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=auth.uid())))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT DISTINCT e.finished_place FROM public.tournament_entries e
   JOIN public.tournament_prizes tp ON tp.tournament_id=e.tournament_id AND tp.position=e.finished_place
   WHERE e.tournament_id=tour.id AND e.finished_place IS NOT NULL ORDER BY e.finished_place
 LOOP
   place:=floor_private.payout_place_context_v1(tour.id,item.finished_place);
   IF place->>'ok'<>'true' THEN RAISE EXCEPTION '%',place->>'error'; END IF;
   SELECT * INTO payment FROM public.tournament_prize_payments pp
   WHERE pp.tournament_id=tour.id AND pp.finished_place=item.finished_place AND pp.status='paid';
   IF FOUND AND (payment.recipient_ref IS DISTINCT FROM (place->>'recipientRef')::uuid
     OR payment.prize_amount IS DISTINCT FROM (place->>'prizeAmount')::numeric)
   THEN RAISE EXCEPTION 'paid_result_conflict'; END IF;
   owed:=owed+(place->>'prizeAmount')::numeric;
   IF payment.id IS NOT NULL THEN paid:=paid+payment.prize_amount;paid_count:=paid_count+1; END IF;
   places:=places||jsonb_build_array((place-'ok'-'tournamentId')||jsonb_build_object(
     'isPaid',payment.id IS NOT NULL,'paidAt',payment.paid_at,'method',payment.method));
 END LOOP;
 RETURN jsonb_build_object('tournamentId',tour.id,'itmPlaces',tour.itm_places,
   'owedTotal',owed,'paidTotal',paid,'paidCount',paid_count,'totalCount',jsonb_array_length(places),'places',places);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_payout_recipients(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_payout_recipients(uuid) TO authenticated;

CREATE FUNCTION floor_private.record_prize_payment_v1(p_tournament_id uuid,p_finished_place integer,
 p_method text,p_proof_url text,p_notes text,p_expected_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();tour public.tournaments;place jsonb;payment public.tournament_prize_payments;
 outcome text:='recorded';
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_found'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=tour.club_id AND
   (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 IF p_finished_place IS NULL OR p_finished_place<1 OR
   (p_method IS NOT NULL AND p_method NOT IN('cash','bank','app','other'))
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_payment_intent'); END IF;
 PERFORM e.id FROM public.tournament_entries e WHERE e.tournament_id=tour.id ORDER BY e.id FOR UPDATE;
 PERFORM tp.id FROM public.tournament_prizes tp WHERE tp.tournament_id=tour.id ORDER BY tp.id FOR SHARE;
 -- Preserve legacy error order: a non-prize place is never payable.
 IF NOT EXISTS(SELECT 1 FROM public.tournament_prizes WHERE tournament_id=tour.id AND position=p_finished_place)
 THEN RETURN jsonb_build_object('ok',false,'error','place_not_in_money'); END IF;
 place:=floor_private.payout_place_context_v1(tour.id,p_finished_place);
 IF place->>'ok'<>'true' THEN RETURN place; END IF;
 IF p_expected_token IS NOT NULL AND p_expected_token IS DISTINCT FROM place->>'confirmationToken'
 THEN RETURN jsonb_build_object('ok',false,'error','payout_confirmation_stale'); END IF;
 SELECT * INTO payment FROM public.tournament_prize_payments
 WHERE tournament_id=tour.id AND finished_place=p_finished_place AND status='paid';
 IF FOUND THEN
   IF payment.recipient_ref IS DISTINCT FROM (place->>'recipientRef')::uuid
     OR payment.prize_amount IS DISTINCT FROM (place->>'prizeAmount')::numeric
   THEN RETURN jsonb_build_object('ok',false,'error','paid_result_conflict'); END IF;
   outcome:='already_paid';
 ELSE
   INSERT INTO public.tournament_prize_payments(tournament_id,club_id,finished_place,prize_amount,
     recipient_ref,recipient_name,status,paid_by,method,proof_url,notes)
   VALUES(tour.id,tour.club_id,p_finished_place,(place->>'prizeAmount')::numeric,
     (place->>'recipientRef')::uuid,place->>'recipientName','paid',actor,p_method,p_proof_url,p_notes)
   RETURNING * INTO payment;
 END IF;
 RETURN jsonb_build_object('ok',true,'outcome',outcome,'payment_id',payment.id,
   'prize_amount',payment.prize_amount,'paid_at',payment.paid_at,'tournament_id',tour.id,
   'finished_place',p_finished_place,'entry_id',place->>'entryId','recipient_ref',payment.recipient_ref);
END;
$$;
REVOKE ALL ON FUNCTION floor_private.record_prize_payment_v1(uuid,integer,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.record_tournament_prize_payment(p_tournament_id uuid,p_finished_place integer,
 p_method text DEFAULT NULL,p_proof_url text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT floor_private.record_prize_payment_v1(p_tournament_id,p_finished_place,p_method,p_proof_url,p_notes,NULL);
$$;
REVOKE ALL ON FUNCTION public.record_tournament_prize_payment(uuid,integer,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_tournament_prize_payment(uuid,integer,text,text,text) TO authenticated,service_role;

CREATE FUNCTION public.record_tournament_prize_payment_v2(p_tournament_id uuid,p_finished_place integer,
 p_method text,p_expected_token text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();payload jsonb;receipt floor_private.payout_payment_receipts_v1;result jsonb;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
 IF p_request_id IS NULL OR p_expected_token IS NULL OR p_expected_token!~'^[a-f0-9]{32}$'
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_payment_intent'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   WHERE t.id=p_tournament_id AND (c.owner_id=actor OR EXISTS(
     SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 payload:=jsonb_build_object('tournament_id',p_tournament_id,'finished_place',p_finished_place,
   'method',p_method,'expected_token',p_expected_token);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO receipt FROM floor_private.payout_payment_receipts_v1
 WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
   IF receipt.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'error','request_payload_conflict'); END IF;
   RETURN receipt.result;
 END IF;
 result:=floor_private.record_prize_payment_v1(p_tournament_id,p_finished_place,p_method,NULL,NULL,p_expected_token);
 INSERT INTO floor_private.payout_payment_receipts_v1(actor_id,request_id,payload,result)
 VALUES(actor,p_request_id,payload,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_tournament_prize_payment_v2(uuid,integer,text,text,uuid) TO authenticated;
-- Read-only recovery never retries a payment or exposes another actor's receipt.
CREATE FUNCTION public.get_tournament_prize_payment_receipt_v2(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt floor_private.payout_payment_receipts_v1;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=auth.uid() AND request_id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
   WHERE t.id=(receipt.payload->>'tournament_id')::uuid AND (c.owner_id=auth.uid() OR EXISTS(
     SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id=c.id AND cc.user_id=auth.uid())))
 THEN RAISE EXCEPTION 'actor_not_allowed' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('found',true,'actor_id',receipt.actor_id,'request_id',receipt.request_id,
   'payload',receipt.payload,'result',receipt.result);
END;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_prize_payment_receipt_v2(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_prize_payment_receipt_v2(uuid) TO authenticated;
COMMIT;
