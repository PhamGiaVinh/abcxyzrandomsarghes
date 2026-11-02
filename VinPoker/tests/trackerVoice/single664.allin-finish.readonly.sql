\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND hand_number=3 AND status='completed' AND source_revision=33 AND community_cards='["2c","3d","7h","9s","Tc"]'::jsonb);
 ASSERT (SELECT count(*)=10 AND sum(action_amount)=40000 FROM public.hand_actions WHERE hand_id='a9e63051-3333-45d3-8f76-15ab01bc08aa');
 ASSERT (SELECT count(*)=8 AND sum(starting_stack)=160000 AND sum(ending_stack)=160000 FROM public.hand_players WHERE hand_id='a9e63051-3333-45d3-8f76-15ab01bc08aa');
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND seat_number=7 AND starting_stack=19900 AND ending_stack=0 AND is_eliminated);
 ASSERT EXISTS(SELECT 1 FROM public.hand_players WHERE hand_id='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND seat_number=9 AND ending_stack=40200);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND status='busted' AND current_stack=0 AND entry_no=1);
 ASSERT (SELECT count(*)=7 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(applied_amount)=800000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND operation_type='record_tracker_manual_hand_v1' AND request_id='5f9816ff-896f-4693-bdd9-de17d2b06fa1' AND result->>'hand_id'='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND result->>'committed_source_revision'='33' AND result->>'starting_total'='160000' AND result->>'ending_total'='160000');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND hand_number=4);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='a9e63051-3333-45d3-8f76-15ab01bc08aa' AND source_revision=33 AND status='pending');
END $$;
ROLLBACK;
SELECT 'SINGLE664_ACTUAL_HAND3_ALLIN_FINISH_BUST_CONSERVATION_PASS';
