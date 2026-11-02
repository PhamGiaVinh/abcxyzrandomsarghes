\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
DO $$ DECLARE finalization jsonb;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND status='completed');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_events WHERE id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND guarantee_amount=2500000);
 ASSERT (SELECT count(*)=16 AND sum(applied_amount)=1840000 FROM public.cashier_buyin_movements WHERE tournament_id IN('782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee','4cd3af4d-7e1d-4042-855f-04fb6777e580'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id IN('782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee','4cd3af4d-7e1d-4042-855f-04fb6777e580'));
 SELECT to_jsonb(f) INTO STRICT finalization FROM public.multi_day_payout_finalizations_v1 f WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 ASSERT (finalization->>'fee_vnd')::numeric=240000 AND (finalization->>'recorded_overlay_vnd')::numeric=900000 AND (finalization->>'unpaid_obligation_vnd')::numeric=2500000 AND (finalization->>'required_shortfall_vnd')::numeric=0;
 ASSERT jsonb_array_length(finalization->'obligations')=15;
 ASSERT (SELECT sum((x->>'totalVnd')::numeric)=2500000 AND sum((x->>'paidVnd')::numeric)=0 AND count(DISTINCT x->>'participationId')=15 FROM jsonb_array_elements(finalization->'obligations')x);
 ASSERT (SELECT count(*)=16 AND sum(total_value)=320000 AND bool_and(sealed) FROM public.chip_bag WHERE tournament_id IN('782a5196-5ea1-44ed-8a27-1b872d5f88d9','fdf91018-09f3-4cdc-b76a-f688eb216cee'));
 ASSERT (SELECT count(*)=15 AND sum(carried_stack)=300000 AND bool_and(policy='SELECT_LARGEST') FROM public.multi_day_final_participations_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d');
 ASSERT (SELECT count(*)=15 AND count(*) FILTER(WHERE status='busted')=14 AND sum(current_stack)=300000 FROM public.tournament_entries WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND is_active);
 ASSERT (SELECT count(*)=15 FROM public.tournament_hands h JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s WHERE h.tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580' AND h.status='completed' AND o.status='verified' AND o.verification_scope='historical_display' AND o.source_revision=h.source_revision AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND auto_swing_enabled);
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE recipients jsonb;BEGIN
 recipients:=public.get_tournament_payout_recipients('4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT recipients->>'mode'='multi_day' AND jsonb_array_length(recipients->'places')=15;
 ASSERT (recipients->>'owedTotal')::numeric=2500000 AND (recipients->>'paidTotal')::numeric=0;
 ASSERT (SELECT count(DISTINCT x->>'recipientRef')=15 AND bool_and(length(x->>'recipientName')>0) FROM jsonb_array_elements(recipients->'places')x);
END $$;
ROLLBACK;
SELECT 'MAIN760_ORIGINAL_SCOPE_CASH1840K_FEES240K_OVERLAY900K_15_NAMED_UNPAID2500K_CARRY300K_BAGS320K_CURRENT15PROOFS_PRESERVED';
