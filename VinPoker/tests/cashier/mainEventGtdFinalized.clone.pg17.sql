-- After actual config217 browser save/finalize, ONLY on disposable GTD clone.
-- Caller runs BEGIN/ROLLBACK. Provider verification is SIMULATED, not a transfer.
DO $$
DECLARE f public.multi_day_payout_finalizations_v1%ROWTYPE; receipt jsonb;
BEGIN
 ASSERT current_database()='vinpoker_config217_browser_20261021';
 ASSERT inet_server_port()=55441;
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
   'VINPOKER_LOCAL_CONFIG217_BROWSER_DISPOSABLE_20261021';
 SELECT * INTO STRICT f FROM public.multi_day_payout_finalizations_v1
   WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 ASSERT f.recorded_overlay_vnd=900000 AND f.direct_pool_vnd=1600000;
 ASSERT f.fee_vnd=240000 AND f.unpaid_obligation_vnd=2500000 AND f.paid_player_vnd=0;
 ASSERT f.required_shortfall_vnd=0 AND f.unallocated_pool_vnd=0;
 ASSERT jsonb_array_length(f.obligations)=15;
 ASSERT (SELECT sum((r->>'totalVnd')::bigint) FROM jsonb_array_elements(f.obligations) r)=2500000;
 ASSERT (SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE event_id=f.event_id)=1;
 ASSERT (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=f.final_tournament_id)=4;
 ASSERT (SELECT sum(amount) FROM public.tournament_prizes WHERE tournament_id=f.final_tournament_id)=1180000;
 ASSERT (SELECT count(*) FROM private.multi_day_prize_configurations_v1 WHERE event_id=f.event_id)=1;
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_prize_write_intents_v1);
 ASSERT EXISTS(SELECT 1 FROM public.bank_transactions WHERE id='f07d27ae-d38f-4cc7-9d96-de26c02c7211'
   AND amount=900000 AND status='matched' AND raw_payload->>'localSimulation'='true'
   AND api_verified_source='LOCAL_SIMULATED_PROVIDER_NOT_REAL');
 PERFORM set_config('request.jwt.claim.sub',f.actor_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor_id,'role','authenticated')::text,true);
 receipt:=public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,f.funding_revision,
   f.qualification_revision,f.payout_input_hash,f.request_id);
 ASSERT receipt->>'state'='FINALIZED_OBLIGATIONS' AND receipt->>'idempotent'='true';
 ASSERT receipt->>'paymentExecution'='NOT_PERFORMED';
 ASSERT (SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id=f.event_id)=1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=f.final_tournament_id);
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
 BEGIN
   PERFORM public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,f.funding_revision,
     f.qualification_revision,f.payout_input_hash,f.request_id);
   RAISE EXCEPTION 'outsider received owner finalization replay';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RAISE NOTICE 'MAIN_EVENT_GTD_CLONE_REAL_CONFIG_FINALIZE_REPLAY_CONSERVATION_NO_PAYMENT_PASS';
END $$;
