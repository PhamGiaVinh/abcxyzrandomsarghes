\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*)=1 FROM public.tournament_hands WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND status='completed' AND NOT is_voided AND source_revision=15 AND pot_size=200);
 ASSERT (SELECT count(*)=5 AND sum(action_amount)=300 FROM public.hand_actions WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a');
 ASSERT (SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack) ORDER BY seat_number)='[[6,20000,20000],[7,20000,19900],[8,20000,20100],[9,20000,20000]]'::jsonb FROM public.hand_players WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a');
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(applied_amount)=800000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*)=1 FROM floor_private.floor_table_v3_existing_receipt('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','record_tracker_manual_hand_v1','62671214-a5a8-492b-af17-64219d0e8061') r WHERE r.result->>'hand_id'='4f120026-cf38-4db3-bb05-ae6feaabf59a');
 ASSERT (SELECT count(*)=1 FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(o.hand_id) s WHERE o.hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND o.source_revision=15 AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash AND o.status='verified' AND o.verification_scope='historical_display');
 ASSERT (SELECT count(*)=1 FROM public.tracker_historical_display_queue WHERE hand_id='4f120026-cf38-4db3-bb05-ae6feaabf59a' AND source_revision=15 AND status='completed');
 ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'history_worker_%');
 ASSERT (SELECT NOT auto_swing_enabled FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
ROLLBACK;
SELECT 'SINGLE647_FINISH_RECEIPT_CHIP_AND_CURRENT_PROOF_READONLY_PASS';
