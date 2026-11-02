-- Retained browser Hand35: all-in, board plays, lost Finish response recovery.
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='3787718f-ef28-485d-aef6-342241c6fe40'
  AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'
  AND tournament_table_id='d294f4a4-082b-4efc-a6ca-1f96579ea344'
  AND table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND hand_number=35
  AND status='completed' AND NOT is_voided AND source_revision=15 AND pot_size=2200
  AND button_seat=1 AND tracker_sb_position=1 AND tracker_bb_position=2
  AND community_cards='["2c","3d","4h","5s","6c"]'::jsonb);
 ASSERT (SELECT count(*)=4 AND sum(action_amount)=60000 FROM public.hand_actions WHERE hand_id='3787718f-ef28-485d-aef6-342241c6fe40');
 ASSERT (SELECT array_agg(action_type::text ORDER BY action_order)=ARRAY['post_sb','post_bb','all_in','call']
  FROM public.hand_actions WHERE hand_id='3787718f-ef28-485d-aef6-342241c6fe40');
 ASSERT (SELECT count(*)=2 AND sum(starting_stack)=60000 AND sum(ending_stack)=60000 AND bool_and(NOT is_eliminated)
  FROM public.hand_players WHERE hand_id='3787718f-ef28-485d-aef6-342241c6fe40');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='3787718f-ef28-485d-aef6-342241c6fe40'
  AND seat_number=1 AND starting_stack=58900 AND ending_stack=58900 AND hole_cards='["Ah","Ad"]'::jsonb);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='3787718f-ef28-485d-aef6-342241c6fe40'
  AND seat_number=2 AND starting_stack=1100 AND ending_stack=1100 AND hole_cards='["Kh","Kd"]'::jsonb);
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE operation_type='record_tracker_manual_hand_v1'
  AND result->>'hand_id'='3787718f-ef28-485d-aef6-342241c6fe40');
 ASSERT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='65a6a27a-3673-4d49-b753-2f4a43611c50'
  AND actor_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND operation_type='record_tracker_manual_hand_v1'
  AND result->>'status'='success' AND (result->>'committed_source_revision')::bigint=15
  AND (result->>'expected_source_revision')::bigint=12
  AND (result->>'starting_total')::bigint=60000 AND (result->>'ending_total')::bigint=60000);
 ASSERT (SELECT array_agg(chip_count ORDER BY seat_number)=ARRAY[58900,1100]::integer[]
  FROM public.tournament_seats WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND status='in_progress' AND NOT is_voided);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
  AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=12 AND revision=16);
 RAISE NOTICE 'HAND554_BOARD_PLAYS_ALLIN_60K_2200POT_ONE_RECOVERED_FINISH_PASS';
END $$;
ROLLBACK;
