\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*)=1 FROM public.tournament_redraw_batches WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND id='7871497a-26ec-4f36-a582-145802d066cc' AND status='applied');
 ASSERT (SELECT count(*)=3 FROM public.table_operation_receipts WHERE actor_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'
  AND result->>'batch_id'='7871497a-26ec-4f36-a582-145802d066cc' AND request_id IN('3481f140-c6cb-4048-8fd8-0a681bfcf5dc','e394408f-b610-45ec-9d8b-b03dc64991b4','b812302c-a59f-43b2-b78a-fc7be0d67aa8'));
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
  JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id WHERE s.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND s.is_active
  AND s.table_id=tt.id AND tt.game_table_id='991b1e8e-da4c-461a-9b39-ddebd7a5d044' AND e.seat_id=s.id AND e.table_id=tt.game_table_id AND e.seat_number=s.seat_number AND e.current_stack=s.chip_count);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats WHERE entry_id='86dc0814-e2f2-46ee-86f0-a68e9f57d6b7' AND is_active AND seat_number=3 AND chip_count=20000);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND closed_at IS NULL AND control_mode='tracker' AND control_epoch=5 AND redraw_hold_batch_id IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND revision=3 AND closed_at IS NOT NULL AND close_reason='tournament_redraw');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='cancelled');
 ASSERT (SELECT count(*)=2 FROM public.dealer_attendance WHERE id IN('6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a','1f3f1e56-db9d-46b9-9e3b-531845da5802') AND current_state='available' AND status='checked_in' AND pre_assigned_table_id IS NULL);
 ASSERT (SELECT count(*)=8 FROM public.seat_draw_receipts r JOIN public.tournament_entries e ON e.id=r.entry_id WHERE e.tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND e.status='seated' AND r.status IN('issued','printed') AND r.seat_id=e.seat_id);
 ASSERT (SELECT count(*)=9 AND sum(applied_amount)=900000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND NOT auto_swing_enabled);
END $$;
SET LOCAL request.jwt.claims='{"role":"anon"}';
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_public_tournament_redraw_v1('c367013a-3ed3-48af-ad48-3915acadc50e')->>'batch_id' IS NULL;
END $$;
ROLLBACK;
SELECT 'SINGLE677_REDRAW_RELOAD_RECEIPTS_ENTRY2_SEATS180K_CASH900K_DEALER_CLOSE_TV_CONTINUE_PASS';
