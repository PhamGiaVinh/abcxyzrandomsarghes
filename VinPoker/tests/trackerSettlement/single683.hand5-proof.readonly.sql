\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ DECLARE outcome jsonb; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 SELECT o.public_outcome INTO STRICT outcome FROM public.tournament_settlement_outcomes o
 CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s
 WHERE o.hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND o.source_revision=30
  AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash
  AND o.verification_scope='historical_display' AND o.status='verified';
 ASSERT jsonb_array_length(outcome->'players')=7;
 ASSERT outcome->'refunds'->0->>'playerId'='a11b1317-4885-4835-8d2e-fb435f7b24e2';
 ASSERT outcome->'refunds'->0->>'amount'='20000';
 ASSERT jsonb_array_length(outcome->'refunds')=1;
 ASSERT outcome->'pots'->0->>'amount'='40000';
 ASSERT outcome->'pots'->0->'allocations'->0->>'winnerId'='a11b1317-4885-4835-8d2e-fb435f7b24e2';
 ASSERT outcome->'pots'->0->'allocations'->0->>'amount'='40000';
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND source_revision=30 AND status='completed');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'history_worker_%');
 ASSERT (SELECT count(*)=6 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number>=6);
END $$;
ROLLBACK;
SELECT 'SINGLE683_CURRENT_PROOF30_POT40K_REFUND20K_7FROZEN_6CURRENT_180K_CASH900K_ROLES_CLEAN_PASS';
