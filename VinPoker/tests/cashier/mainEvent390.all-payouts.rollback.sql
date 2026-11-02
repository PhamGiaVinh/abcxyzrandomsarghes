\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441,'main390_local_only';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron')),'main390_no_external_jobs';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'),'main390_original_unpaid_required';
END $$;
-- Transaction-local canary release scope, invisible to other connections and
-- restored by outer ROLLBACK. First unarmed attempt correctly returned release_off.
INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids)
 VALUES(true,true,ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid])
 ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,allowed_club_ids=excluded.allowed_club_ids;
CREATE TEMP TABLE main390_facts AS SELECT
 (SELECT md5(to_jsonb(f)::text) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d') finalization,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.cashier_buyin_movements t) cash,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.bank_transactions t) bank,
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.tournament_entries t) entries;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"675fe35e-60a8-4452-bb90-e79486d54da6"}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE event_id uuid:='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'; tour uuid:='4cd3af4d-7e1d-4042-855f-04fb6777e580';
 rank_no integer; read jsonb; person jsonb; paid jsonb; receipt jsonb; result jsonb; state jsonb;
 request_id uuid; first_request uuid; first_person uuid; first_token text; total_paid bigint:=0;
BEGIN
 read:=public.get_tournament_payout_recipients(tour);
 ASSERT read->>'mode'='multi_day' AND jsonb_array_length(read->'places')=15;
 ASSERT (SELECT count(DISTINCT x->>'recipientRef') FROM jsonb_array_elements(read->'places') x)=15;
 FOR rank_no IN 1..15 LOOP
  -- Each payment changes accounting revision; use the fresh canonical token.
  read:=public.get_tournament_payout_recipients(tour);
  SELECT x INTO STRICT person FROM jsonb_array_elements(read->'places') x WHERE (x->>'finishedPlace')::integer=rank_no;
  ASSERT length(person->>'recipientName')>0 AND person->>'isPaid'='false';
  ASSERT (person->>'prizeAmount')::bigint>0 AND person->>'multiDayEventId'=event_id::text;
  request_id:=gen_random_uuid();
  paid:=public.record_multi_day_prize_payment_v1(event_id,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',request_id);
  ASSERT paid->>'ok'='true',format('main390_payment_rank_%s:%s',rank_no,paid);
  ASSERT (paid->>'prize_amount')::bigint=(person->>'prizeAmount')::bigint;
  ASSERT public.record_multi_day_prize_payment_v1(event_id,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',request_id)=paid,'main390_exact_replay';
  receipt:=public.get_tournament_prize_payment_receipt_v2(request_id);
  ASSERT receipt->>'found'='true' AND receipt->'result'=paid;
  ASSERT receipt->'payload'->>'participation_id'=person->>'multiDayParticipationId';
  result:=public.record_multi_day_prize_payment_v1(event_id,(person->>'multiDayParticipationId')::uuid,'bank',person->>'confirmationToken',request_id);
  ASSERT result->>'error'='request_payload_conflict';
  IF rank_no=1 THEN first_request:=request_id;first_person:=(person->>'multiDayParticipationId')::uuid;first_token:=person->>'confirmationToken';
  ELSE
   result:=public.record_multi_day_prize_payment_v1(event_id,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',first_request);
   ASSERT result->>'error'='request_payload_conflict','main390_cross_recipient_key';
  END IF;
  total_paid:=total_paid+(person->>'prizeAmount')::bigint;
  state:=public.multi_day_payout_postfinal_state_v1(event_id);
  ASSERT (state->>'paidPlayerVnd')::bigint=total_paid;
  ASSERT (state->>'unpaidObligationVnd')::bigint=2500000-total_paid;
 END LOOP;
 ASSERT total_paid=2500000;
 read:=public.get_tournament_payout_recipients(tour);
 ASSERT (SELECT bool_and((x->>'isPaid')::boolean AND (x->>'prizeAmount')::bigint=0 AND (x->>'paidAmount')::bigint=(x->>'obligationAmount')::bigint) FROM jsonb_array_elements(read->'places') x),
  (SELECT jsonb_agg(jsonb_build_object('rank',x->'finishedPlace','paid',x->'isPaid','paidAmount',x->'paidAmount','prizeAmount',x->'prizeAmount'))::text FROM jsonb_array_elements(read->'places') x);
 result:=public.record_multi_day_prize_payment_v1(event_id,first_person,'cash',first_token,gen_random_uuid());
 ASSERT result->>'error'='payout_confirmation_stale','main390_stale_paid_confirmation';
 RAISE NOTICE 'MAIN390_FIFTEEN_NAMED_CANONICAL_PAYOUTS_2500K_REPLAY_RECEIPT_PAYLOAD_CONFLICT_CURRENT_STATE_PASS';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=15;
 ASSERT (SELECT sum(prize_amount) FROM public.tournament_prize_payments WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580')=2500000;
 ASSERT (SELECT finalization FROM main390_facts)=(SELECT md5(to_jsonb(f)::text) FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT (SELECT cash FROM main390_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.cashier_buyin_movements t);
 ASSERT (SELECT bank FROM main390_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.bank_transactions t);
 ASSERT (SELECT entries FROM main390_facts) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public.tournament_entries t);
END $$;
ROLLBACK;
SELECT 'MAIN390_ROLLBACK_RETAINED_PAYMENTS='||count(*) FROM public.tournament_prize_payments WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580';
