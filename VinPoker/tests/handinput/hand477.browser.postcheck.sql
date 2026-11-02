-- Retained browser477 snapshot: Hand34 finished; current seats change in later hands.
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
  AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='b3414623-e129-4c0a-99ce-37a5915bb511'
  AND tournament_id='46cab483-91e7-4220-aacf-e17bdf05269c'
  AND table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
  AND hand_number=34 AND status='completed' AND NOT is_voided AND source_revision=19
  AND button_seat=2 AND tracker_sb_position=2 AND tracker_bb_position=1
  AND pot_size=400 AND community_cards='["As","Kh","Qd","7c","2d"]'::jsonb);
 ASSERT (SELECT count(*)=10 AND sum(action_amount)=600 FROM public.hand_actions
  WHERE hand_id='b3414623-e129-4c0a-99ce-37a5915bb511');
 ASSERT (SELECT array_agg(action_type::text ORDER BY action_order)=
  ARRAY['post_sb','post_bb','call','check','check','check','check','check','bet','fold']
  FROM public.hand_actions WHERE hand_id='b3414623-e129-4c0a-99ce-37a5915bb511');
 ASSERT (SELECT count(*)=2 AND sum(starting_stack)=60000 AND sum(ending_stack)=60000
  AND bool_and(hole_cards='[]'::jsonb) FROM public.hand_players
  WHERE hand_id='b3414623-e129-4c0a-99ce-37a5915bb511');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='b3414623-e129-4c0a-99ce-37a5915bb511'
  AND seat_number=1 AND starting_stack=58700 AND ending_stack=58900);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='b3414623-e129-4c0a-99ce-37a5915bb511'
  AND seat_number=2 AND starting_stack=1300 AND ending_stack=1100);
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats
  WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND is_active);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats
  WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND is_active AND seat_number=1 AND chip_count=58900);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats
  WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND is_active AND seat_number=2 AND chip_count=1100);
 ASSERT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='71ab16b8-c996-47a8-88ad-b128eae92084'
  AND actor_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND operation_type='record_tracker_manual_hand_v1'
  AND result->>'hand_id'='b3414623-e129-4c0a-99ce-37a5915bb511' AND result->>'status'='success'
  AND (result->>'committed_source_revision')::bigint=19
  AND (result->>'starting_total')::bigint=60000 AND (result->>'ending_total')::bigint=60000);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
  AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=12 AND revision=16);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands
  WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND status='in_progress' AND NOT is_voided);
 RAISE NOTICE 'TRACKER477_BROWSER_RIVER10_ACTIONS_BOARD5_RECEIPT_REV19_60K_CONSERVATION_PASS';
END $$;
ROLLBACK;
