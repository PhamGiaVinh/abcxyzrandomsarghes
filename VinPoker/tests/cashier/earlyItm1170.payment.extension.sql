 DECLARE recipients jsonb;context jsonb;request uuid:=gen_random_uuid();result jsonb;replay jsonb;report jsonb;item jsonb;original_token text;BEGIN
  recipients:=public.get_tournament_payout_recipients(final);
  ASSERT recipients->>'isPartial'='true' AND recipients->>'liabilityScope'='INDIVIDUAL',recipients::text;
  ASSERT (recipients->>'totalCount')::integer=1 AND (recipients->>'paidTotal')::numeric=0;
  SELECT x INTO STRICT context FROM jsonb_array_elements(recipients->'places')x WHERE x->>'multiDayParticipationId'=p::text;
  ASSERT (context->>'finishedPlace')::integer=8 AND (context->>'prizeAmount')::numeric=100000;
  original_token:=context->>'confirmationToken';
  -- Fail the actual public marker INSERT after the private proof was inserted.
  -- The nested transaction must leave neither proof, marker nor success receipt.
  PERFORM set_config('role','none',true);
  EXECUTE $fault$CREATE FUNCTION pg_temp.early_payment_fault1170() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN RAISE EXCEPTION 'early_payment_test_insert_fault' USING ERRCODE='ZX170';END; $fn$ $fault$;
  EXECUTE 'CREATE TRIGGER early_payment_fault1170 BEFORE INSERT ON public.tournament_prize_payments FOR EACH ROW EXECUTE FUNCTION pg_temp.early_payment_fault1170()';
  PERFORM set_config('role','authenticated',true);
  BEGIN
   PERFORM public.record_multi_day_prize_payment_v1(event,p,'cash',original_token,request);
   RAISE EXCEPTION 'marker fault was not raised';
  EXCEPTION WHEN SQLSTATE 'ZX170' THEN ASSERT SQLERRM='early_payment_test_insert_fault';END;
  PERFORM set_config('role','none',true);
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
  ASSERT NOT EXISTS(SELECT 1 FROM floor_private.payout_payment_receipts_v1 WHERE actor_id=actor AND request_id=request);
  EXECUTE 'DROP TRIGGER early_payment_fault1170 ON public.tournament_prize_payments';
  EXECUTE 'DROP FUNCTION pg_temp.early_payment_fault1170()';
  PERFORM set_config('role','authenticated',true);
  result:=public.record_multi_day_prize_payment_v1(event,p,'cash',original_token,request);
  ASSERT result->>'ok'='true' AND result->>'outcome'='recorded' AND (result->>'prize_amount')::numeric=100000,result::text;
  replay:=public.record_multi_day_prize_payment_v1(event,p,'cash',original_token,request);ASSERT replay=result,'early replay changed';
  ASSERT public.get_tournament_prize_payment_receipt_v2(request)->'result'=result,'shared receipt missing';
  replay:=public.record_multi_day_prize_payment_v1(event,p,'bank',original_token,request);
  ASSERT replay->>'error'='request_payload_conflict',replay::text;
  replay:=public.record_multi_day_prize_payment_v1(event,p,'cash',original_token,gen_random_uuid());
  ASSERT replay->>'error'='payout_confirmation_stale',replay::text;
  recipients:=public.get_tournament_payout_recipients(final);
  ASSERT (recipients->>'owedTotal')::numeric=100000 AND (recipients->>'paidTotal')::numeric=100000
   AND (recipients->>'paidCount')::integer=1 AND recipients->>'isPartial'='true';
  SELECT x INTO STRICT context FROM jsonb_array_elements(recipients->'places')x WHERE x->>'multiDayParticipationId'=p::text;
  ASSERT context->>'isPaid'='true' AND (context->>'prizeAmount')::numeric=0 AND (context->>'paidAmount')::numeric=100000;
  replay:=public.record_multi_day_prize_payment_v1(event,p,'cash',context->>'confirmationToken',gen_random_uuid());
  ASSERT replay->>'error'='no_unpaid_obligation',replay::text;
  report:=public.get_club_payout_liability_v2('2000-01-01','2100-12-31',club);
  SELECT x INTO STRICT item FROM jsonb_array_elements(report->'perTournament')x WHERE x->>'tournamentId'=final::text;
  ASSERT (item->>'owed')::numeric=100000 AND (item->>'paid')::numeric=100000 AND (item->>'outstanding')::numeric=0,item::text;
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*)=1 AND sum(prize_amount)=100000 FROM public.tournament_prize_payments WHERE tournament_id=final);
  ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
  ASSERT (SELECT count(*)=0 FROM private.multi_day_payment_commits_v1 WHERE event_id=event);
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=final AND finished_place IS NOT NULL);
  ASSERT (SELECT count(*)=7 FROM public.tournament_entries WHERE tournament_id=final AND status<>'busted');
  SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;
  PERFORM set_config('test.e1170.request',request::text,true);
  PERFORM set_config('test.e1170.originalToken',original_token,true);
  PERFORM set_config('test.e1170.result',result::text,true);
  PERFORM set_config('test.e1170',jsonb_build_object('survivors',7,'officialRanks',0,'individualRank',8,'owedVnd',100000,
   'paidVnd',100000,'unpaidVnd',0,'earlyProofs',1,'globalProofs',0,'publicPayments',1,'sharedReceiptReplay',true,
   'payloadConflictRejected',true,'staleTokenRejected',true,'newTokenNoUnpaid',true,'deferredFksValidated',true,'insertFaultAtomicRollback',true,
   'partialCashierRecipients',recipients,'partialFinanceLiability',item)::text,true);
  PERFORM set_config('role','authenticated',true);
 END;
