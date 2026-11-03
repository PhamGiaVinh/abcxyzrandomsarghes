-- Existing isolated LOCAL fixture only. No real transfer; every write rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $$BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='f2766bdd-5c30-4dee-bb3e-812f32d37172' AND name='Cash identity local TEST');
END $$;
CREATE TEMP TABLE payout_activation_before ON COMMIT DROP AS
 SELECT count(*) payments,coalesce(sum(prize_amount),0) amount FROM public.tournament_prize_payments;
SET LOCAL request.jwt.claim.sub='4c1c76ad-d398-4326-9627-3fb60b82ba52';
SET LOCAL request.jwt.claims='{"sub":"4c1c76ad-d398-4326-9627-3fb60b82ba52","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$DECLARE
 tour uuid:='f2766bdd-5c30-4dee-bb3e-812f32d37172'; source jsonb; place jsonb; result jsonb; retry jsonb; receipt jsonb;
 request uuid:=gen_random_uuid(); other_request uuid:=gen_random_uuid();
BEGIN
 source:=public.get_tournament_payout_recipients(tour);
 SELECT value INTO STRICT place FROM jsonb_array_elements(source->'places') WHERE (value->>'finishedPlace')::integer=1;
 ASSERT NOT (place->>'isPaid')::boolean AND (place->>'prizeAmount')::numeric=200000;
 result:=public.record_tournament_prize_payment_v2(tour,1,'cash',repeat('0',32),other_request);
 ASSERT result->>'ok'='false' AND result->>'error'='payout_confirmation_stale',result::text;
 result:=public.record_tournament_prize_payment_v2(tour,1,'cash',place->>'confirmationToken',request);
 ASSERT result->>'ok'='true' AND result->>'outcome'='recorded',result::text;
 ASSERT result->>'entry_id'=place->>'entryId' AND result->>'recipient_ref'=place->>'recipientRef';
 ASSERT (result->>'prize_amount')::numeric=200000;
 retry:=public.record_tournament_prize_payment_v2(tour,1,'cash',place->>'confirmationToken',request);
 ASSERT retry=result,'retry changed the payment receipt';
 receipt:=public.get_tournament_prize_payment_receipt_v2(request);
 ASSERT receipt->>'found'='true' AND receipt->'result'=result,'lost-response recovery mismatch';
 retry:=public.record_tournament_prize_payment_v2(tour,1,'bank',place->>'confirmationToken',request);
 ASSERT retry->>'error'='request_payload_conflict';
 retry:=public.record_tournament_prize_payment_v2(tour,1,'cash',place->>'confirmationToken',gen_random_uuid());
 ASSERT retry->>'outcome'='already_paid' AND retry->>'payment_id'=result->>'payment_id';
 source:=public.get_tournament_payout_recipients(tour);
 ASSERT (source->>'paidTotal')::numeric=200000 AND (source->>'paidCount')::integer=1;
END $$;
-- An unrelated actor cannot read the payment checklist or write a payment.
SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$DECLARE result jsonb;BEGIN
 BEGIN
  PERFORM public.get_tournament_payout_recipients('f2766bdd-5c30-4dee-bb3e-812f32d37172');
  RAISE EXCEPTION 'unauthorized read was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.record_tournament_prize_payment_v2('f2766bdd-5c30-4dee-bb3e-812f32d37172',2,'cash',repeat('0',32),gen_random_uuid());
 ASSERT result->>'ok'='false' AND result->>'error'='actor_not_allowed';
END $$;
RESET ROLE;
DO $$BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_prize_payments)=(SELECT payments+1 FROM payout_activation_before);
 ASSERT (SELECT coalesce(sum(prize_amount),0) FROM public.tournament_prize_payments)=(SELECT amount+200000 FROM payout_activation_before);
END $$;
ROLLBACK;
SELECT 'PAYOUT_ACTIVATION_LOCAL_ROLLBACK_PASS';
