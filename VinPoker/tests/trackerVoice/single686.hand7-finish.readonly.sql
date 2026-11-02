\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='c722177e-6cdf-4346-aecb-ce377895bec8'
  AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
  AND hand_number=7 AND button_seat=3 AND status='completed' AND source_revision=23
  AND tracker_sb_position=4 AND tracker_bb_position=5 AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND pot_size=39600);
 ASSERT (SELECT count(*)=6 AND sum(action_amount)=120000 FROM public.hand_actions WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8');
 ASSERT NOT EXISTS(SELECT 1 FROM public.hand_actions WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8' AND action_type='post_sb');
 ASSERT (SELECT count(*)=5 AND sum(starting_stack)=180000 AND sum(ending_stack)=180000 FROM public.hand_players WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8' AND seat_number=2 AND starting_stack=100200 AND ending_stack=120000 AND hole_cards='["As","Ah"]'::jsonb AND NOT is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8' AND seat_number=5 AND player_id='940d314a-a588-444d-829a-67b78a2ffc3e' AND entry_number=1 AND starting_stack=19800 AND ending_stack=0 AND hole_cards='["Ks","Kh"]'::jsonb AND is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='3add262c-4373-4a04-90e1-ee423aaaad32' AND status='busted' AND current_stack=0);
 ASSERT (SELECT count(*)=4 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND operation_type='record_tracker_manual_hand_v1' AND request_id='12b70369-d40d-4dba-9364-bf02dff78180'
  AND result->>'hand_id'='c722177e-6cdf-4346-aecb-ce377895bec8' AND result->>'committed_source_revision'='23'
  AND result->>'expected_source_revision'='17' AND result->>'control_epoch'='5'
  AND result->>'starting_total'='180000' AND result->>'ending_total'='180000');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number>=8);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8' AND source_revision=23 AND status='pending');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='c722177e-6cdf-4346-aecb-ce377895bec8' AND status='verified');
END $$;
ROLLBACK;
SELECT 'SINGLE686_ACTUAL_HAND7_POT39600_RETURN80400_4SEATS180K_CASH900K_PASS';
