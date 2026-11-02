\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='42999d26-6dd8-413f-bbfd-71b0e33dfe54'
  AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
  AND hand_number=5 AND button_seat=1 AND status='completed' AND source_revision=30
  AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND pot_size=40000);
 ASSERT (SELECT count(*)=9 AND sum(action_amount)=60000 FROM public.hand_actions WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54');
 ASSERT (SELECT count(*)=7 AND sum(starting_stack)=180000 AND sum(ending_stack)=180000 FROM public.hand_players WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND seat_number=2 AND starting_stack=40000 AND ending_stack=60000 AND hole_cards='["As","Ah"]'::jsonb AND NOT is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND seat_number=3 AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND entry_number=2 AND starting_stack=20000 AND ending_stack=0 AND hole_cards='["Ks","Kh"]'::jsonb AND is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND status='busted' AND current_stack=0);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND status='busted' AND current_stack=0);
 ASSERT (SELECT count(*)=6 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND operation_type='record_tracker_manual_hand_v1' AND request_id='a30a7ec6-b878-4489-b279-4bcc2cb74c28'
  AND result->>'hand_id'='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND result->>'committed_source_revision'='30'
  AND result->>'expected_source_revision'='22' AND result->>'control_epoch'='5'
  AND result->>'starting_total'='180000' AND result->>'ending_total'='180000');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number>=6);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND source_revision=30 AND status='pending');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='42999d26-6dd8-413f-bbfd-71b0e33dfe54' AND status='verified');
END $$;
ROLLBACK;
SELECT 'SINGLE682_ACTUAL_HAND5_WAGERS60K_POT40K_RETURN20K_ENTRY2_BUST_6SEATS180K_CASH900K_PASS';
