-- Retained linked Main Event after actual browser configuration/finalization.
-- Provider funding fixture is simulated; all replay/denial probes ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE f public.multi_day_payout_finalizations_v1%ROWTYPE;
 c private.multi_day_prize_configurations_v1%ROWTYPE; payload jsonb; r jsonb; bank uuid;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';ASSERT inet_server_port()=55441;
 SELECT * INTO STRICT f FROM public.multi_day_payout_finalizations_v1
  WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 SELECT * INTO STRICT c FROM private.multi_day_prize_configurations_v1 WHERE event_id=f.event_id;
 ASSERT f.request_id='264bdd6e-33a7-4d7b-837a-e3a6b60a16a6';
 ASSERT c.request_id='eb6a2a90-5c92-4f9a-bda8-74b8adc936ea';
 ASSERT f.direct_pool_vnd=1600000 AND f.recorded_overlay_vnd=900000 AND f.fee_vnd=240000;
 ASSERT f.unpaid_obligation_vnd=2500000 AND f.paid_player_vnd=0 AND f.required_shortfall_vnd=0 AND f.unallocated_pool_vnd=0;
 ASSERT jsonb_array_length(f.obligations)=15;
 ASSERT (SELECT array_agg((v->>'rank')::integer ORDER BY (v->>'rank')::integer) FROM jsonb_array_elements(f.obligations) v)=ARRAY(SELECT generate_series(1,15));
 ASSERT (SELECT sum((v->>'totalVnd')::bigint) FROM jsonb_array_elements(f.obligations) v)=2500000;
 ASSERT (SELECT sum(amount) FROM public.tournament_prizes WHERE tournament_id=f.final_tournament_id)=1180000;
 ASSERT (SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=f.final_tournament_id)=4;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id=f.final_tournament_id AND is_active);
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=f.final_tournament_id)=15;
 ASSERT (SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id=f.final_tournament_id)=300000;
 ASSERT NOT EXISTS(SELECT 1 FROM public.stack_template_issuance i JOIN public.stack_template t ON t.id=i.stack_template_id
   WHERE t.tournament_id=f.final_tournament_id),'D2 carry must not issue physical chips again';
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id=f.final_tournament_id AND status='in_progress');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=f.final_tournament_id);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands h
  CROSS JOIN LATERAL (SELECT public.get_tracker_historical_display_snapshot(h.id,h.tournament_id) s) snapshot
  WHERE h.tournament_id=f.final_tournament_id AND h.status='completed' AND NOT h.is_voided
    AND NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id
     AND o.source_revision=h.source_revision AND o.source_chain_hash=snapshot.s->>'sourceChainHash'
     AND o.status='verified' AND o.verification_scope='historical_display'));
 SELECT id INTO STRICT bank FROM public.bank_transactions WHERE provider_txn_id='LOCAL_MAIN_EVENT216_SIMULATED_OVERLAY900K'
  AND club_id=f.club_id AND amount=900000 AND status='matched' AND raw_payload->>'localSimulation'='true'
  AND raw_payload->>'externalTransfer'='false';
 PERFORM set_config('request.jwt.claim.sub',f.actor_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.actor_id,'role','authenticated')::text,true);
 r:=public.multi_day_record_overlay_v1(f.event_id,'RECORDED',900000,
  'LOCAL_MAIN_EVENT216_SIMULATED_OVERLAY900K','LOCAL TEST club covers full GTD; provider modeled, no transfer',
  NULL,NULL,'9bbdcdb3-befe-41f0-9439-5601b4497216',bank);
 ASSERT r->>'idempotent'='true' AND r->>'recordId'='26f58afa-3ebf-4655-b7b8-d2ab5a0560da';
 payload:=c.receipt->'requestPayload';
 r:=public.multi_day_save_prize_configuration_v1(f.event_id,payload->'rows',payload->>'configuration',
  payload->>'rules',payload->>'funding',payload->>'qualification',payload->>'proposal',c.request_id,payload->>'reason');
 ASSERT r->>'idempotent'='true' AND r->>'state'='CONFIGURED';
 r:=public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,f.funding_revision,
  f.qualification_revision,f.payout_input_hash,f.request_id);
 ASSERT r->>'idempotent'='true' AND r->>'state'='FINALIZED_OBLIGATIONS';
 ASSERT r->>'paymentExecution'='NOT_PERFORMED';
 BEGIN
  PERFORM public.multi_day_save_prize_configuration_v1(f.event_id,payload->'rows',payload->>'configuration',
   payload->>'rules',payload->>'funding',payload->>'qualification',payload->>'proposal',gen_random_uuid(),'TEST forbidden postfinal new table');
  RAISE EXCEPTION 'postfinal authoring accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_configuration_already_finalized_or_paid';END;
 BEGIN
  UPDATE public.bank_transactions SET amount=amount WHERE id=bank;
  RAISE EXCEPTION 'allocated bank evidence mutable';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_allocated_bank_immutable';END;
 ASSERT (SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE event_id=f.event_id)=1;
 ASSERT (SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id=f.event_id)=1;
 ASSERT (SELECT count(*) FROM private.multi_day_prize_configurations_v1 WHERE event_id=f.event_id)=1;
 ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_prize_write_intents_v1);
 RAISE NOTICE 'LINKED_MAIN_EVENT_15_RANKS_2500K_OBLIGATIONS_CURRENT_HISTORY_REPLAYS_IMMUTABLE_NO_PAYMENT_PASS';
END $$;
ROLLBACK;
