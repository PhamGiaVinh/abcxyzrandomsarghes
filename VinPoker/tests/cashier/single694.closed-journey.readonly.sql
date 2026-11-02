\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='completed' AND prize_pool=0);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_close_report WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e'
  AND tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND closed_by='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND entry_count=9 AND buy_in_total=900000 AND cash_in_total=900000 AND club_revenue=0
  AND prize_total=0 AND cashier_balance=900000 AND reconcile_delta=900000 AND NOT reconciled
  AND detail->'official_results'='{"field":8,"status":"finalized","version":1}'::jsonb);
 ASSERT floor_private.felt_official_results_close_status_v1('c367013a-3ed3-48af-ad48-3915acadc50e')='{"field":8,"status":"preserved"}'::jsonb;
 ASSERT (SELECT jsonb_agg(jsonb_build_array(id,finished_place) ORDER BY finished_place)='[
  ["129884e6-d2e4-4795-ade1-5bb1905e784f",1],["60968a2e-f376-4c4b-a071-f7726b5545dc",2],
  ["0a4c6f87-5495-4caf-ab91-f9499965532a",3],["d887d523-4554-477c-a020-9928e66eff9a",4],
  ["3add262c-4373-4a04-90e1-ee423aaaad32",5],["c530aeb0-175c-44f4-8643-2c30d5dce30b",6],
  ["86dc0814-e2f2-46ee-86f0-a68e9f57d6b7",7],["a5eb86d6-4280-4085-b9a9-2e35b18cca20",8]]'::jsonb
  FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND finished_place IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='c08959a4-38f8-4df9-8fd4-033c1bdf8a9e' AND entry_no=1 AND status='busted' AND current_stack=0 AND finished_place IS NULL AND bust_order=2);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='129884e6-d2e4-4795-ade1-5bb1905e784f' AND status='registered' AND current_stack=180000 AND table_id IS NULL AND seat_id IS NULL AND bust_order IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_tables WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='active');
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND closed_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND revision=22 AND control_epoch=5 AND closed_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='e70ae2f2-3aef-40d7-b8b3-37fda915d2fd' AND status='completed' AND released_at IS NOT NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='e03c9a69-7c3d-4431-aa98-a801015dfae5' AND current_state='available' AND check_out_time IS NULL AND last_released_at IS NULL AND total_worked_minutes_today=0);
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND operation_type='floor_free_sit_player_v1' AND request_id='c7f0bb45-16c9-4d63-9e9a-82397542e64e' AND result->>'stack_preserved'='180000' AND result->>'revision'='21' AND result->>'payout_applied'='false');
 ASSERT (SELECT count(*)=1 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND operation_type='close_tournament_table_v3' AND request_id='9f46504a-b0a7-4938-bfed-11e53d913c1d' AND result->>'table_session_id'='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND result->>'revision'='22' AND result->>'dealer_assignments_released'='1');
 ASSERT (SELECT count(*)=10 AND count(DISTINCT h.id)=10 FROM public.tournament_hands h JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(h.id) s WHERE h.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND h.status='completed' AND o.status='verified' AND o.verification_scope='historical_display' AND o.source_revision=h.source_revision AND o.source_revision=s.source_revision AND o.source_chain_hash=s.source_chain_hash);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prizes WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND auto_swing_enabled);
END $$;
ROLLBACK;
SELECT 'SINGLE694_ACTUAL375_CANONICAL_CLOSE_LATEST_ENTRY_8PLACES_9BULLETS_WINNER180K_DEALER_RELEASE_TEN_PROOFS_CASH900K_PASS';
