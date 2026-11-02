\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='a3228a49-cd3a-485c-a334-a001c4f457d6'
  AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
  AND hand_number=9 AND button_seat=5 AND status='completed' AND source_revision=17
  AND tracker_sb_position=6 AND tracker_bb_position=7 AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND pot_size=40000);
 ASSERT (SELECT count(*)=4 AND sum(action_amount)=160000 FROM public.hand_actions WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6');
 ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6' AND action_type='post_sb');
 ASSERT (SELECT count(*)=3 AND sum(starting_stack)=180000 AND sum(ending_stack)=180000 FROM public.hand_players WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6' AND seat_number=2 AND starting_stack=140000 AND ending_stack=160000 AND hole_cards='["As","Ah"]'::jsonb AND NOT is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6' AND seat_number=7 AND player_id='5aa1f9dd-0c9a-4372-80e4-bcc1209a2ac5' AND entry_number=1 AND starting_stack=20000 AND ending_stack=0 AND hole_cards='["Ks","Kh"]'::jsonb AND is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='0a4c6f87-5495-4caf-ab91-f9499965532a' AND status='busted' AND current_stack=0);
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND operation_type='record_tracker_manual_hand_v1' AND request_id='ce7df86f-cd78-42fa-81b8-548c0605f3ab'
  AND result->>'hand_id'='a3228a49-cd3a-485c-a334-a001c4f457d6' AND result->>'committed_source_revision'='17'
  AND result->>'expected_source_revision'='13' AND result->>'control_epoch'='5'
  AND result->>'starting_total'='180000' AND result->>'ending_total'='180000');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number>=10);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6' AND source_revision=17 AND status='pending');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='a3228a49-cd3a-485c-a334-a001c4f457d6' AND status='verified');
 ASSERT floor_private.felt_official_results_close_status_v1('c367013a-3ed3-48af-ad48-3915acadc50e')='{"field":8,"status":"official_results_not_finished"}'::jsonb;
 ASSERT (SELECT count(*)=9 AND count(*) FILTER(WHERE finished_place IS NOT NULL)=0 FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
ROLLBACK;
SELECT 'SINGLE690_HAND9_RELOAD_RECOVERED_POT40K_RETURN120K_2SEATS180K_CASH900K_PENDING_PROOF_PASS';
