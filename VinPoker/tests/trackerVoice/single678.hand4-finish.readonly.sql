\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND hand_number=4 AND button_seat=9 AND status='completed' AND source_revision=33 AND community_cards='["2s","3h","7d","9c","Th"]'::jsonb AND pot_size=40000);
 ASSERT (SELECT count(*)=10 AND sum(action_amount)=40000 FROM public.hand_actions WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25');
 ASSERT (SELECT count(*)=8 AND sum(starting_stack)=180000 AND sum(ending_stack)=180000 FROM public.hand_players WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND seat_number=1 AND starting_stack=20000 AND ending_stack=0 AND hole_cards='["Kc","Kd"]'::jsonb AND is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND seat_number=2 AND ending_stack=40000 AND hole_cards='["Ac","Ad"]'::jsonb);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND player_id='e5eded2a-1efc-406f-b794-316a39a20a51' AND entry_number=2 AND seat_number=3 AND ending_stack=20000);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='a5eb86d6-4280-4085-b9a9-2e35b18cca20' AND status='busted' AND current_stack=0);
 ASSERT (SELECT count(*)=7 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND operation_type='record_tracker_manual_hand_v1' AND request_id='77fbf2c6-dfd8-405c-9b00-ff927d11c81b' AND result->>'hand_id'='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND result->>'committed_source_revision'='33' AND result->>'control_epoch'='5' AND result->>'starting_total'='180000' AND result->>'ending_total'='180000');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND operation='undo_open_hand');
 ASSERT EXISTS(SELECT 1 FROM private.tracker_undo_intent_cancellations_v1 WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND idempotency_key='4d403474-801d-4b38-8fdf-3d46151ed44d');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number=5);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='6eb869b7-49da-4b84-bdee-80a5b5feea25' AND source_revision=33 AND status='pending');
END $$;
ROLLBACK;
SELECT 'SINGLE678_ACTUAL_HAND4_EPOCH5_ENTRY2_ALLIN_FINISH_180K_CASH900K_PASS';
