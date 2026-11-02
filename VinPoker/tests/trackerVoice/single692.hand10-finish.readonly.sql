\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='ba4eede3-8cf4-4866-bc1b-ff916aad161f'
  AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5'
  AND hand_number=10 AND button_seat=8 AND status='completed' AND source_revision=15
  AND tracker_sb_position=8 AND tracker_bb_position=2 AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb AND pot_size=40000);
 ASSERT (SELECT jsonb_agg(jsonb_build_array(action_type,action_amount) ORDER BY action_order)='[["post_sb",100],["post_bb",200],["all_in",19900],["call",19800]]'::jsonb FROM public.hand_actions WHERE hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f');
 ASSERT (SELECT count(*)=2 AND sum(starting_stack)=180000 AND sum(ending_stack)=180000 FROM public.hand_players WHERE hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f' AND seat_number=2 AND starting_stack=160000 AND ending_stack=180000 AND hole_cards='["As","Ah"]'::jsonb AND NOT is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f' AND seat_number=8 AND player_id='9b9bf3e6-248a-4f2f-955f-8aa49db3148e' AND entry_number=1 AND starting_stack=20000 AND ending_stack=0 AND hole_cards='["Ks","Kh"]'::jsonb AND is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='60968a2e-f376-4c4b-a071-f7726b5545dc' AND status='busted' AND current_stack=0);
 ASSERT (SELECT count(*)=1 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND operation_type='record_tracker_manual_hand_v1' AND result->>'hand_id'='ba4eede3-8cf4-4866-bc1b-ff916aad161f'
  AND request_id='e59ba871-6116-4d71-997b-e5086925ba63' AND result->>'committed_source_revision'='15'
  AND result->>'expected_source_revision'='12' AND result->>'control_epoch'='5'
  AND result->>'starting_total'='180000' AND result->>'ending_total'='180000');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number>=11);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f' AND source_revision=15 AND status='pending');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='ba4eede3-8cf4-4866-bc1b-ff916aad161f' AND status='verified');
 ASSERT floor_private.felt_official_results_close_status_v1('c367013a-3ed3-48af-ad48-3915acadc50e')='{"field":8,"status":"ready_to_finalize"}'::jsonb;
 ASSERT (SELECT count(*)=9 AND count(*) FILTER(WHERE finished_place IS NOT NULL)=0 FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
ROLLBACK;
SELECT 'SINGLE692_HEADSUP_HAND10_ONE_SURVIVOR180K_ONE_FINISH_RECEIPT_CASH900K_READY_TO_FINALIZE_PASS';
