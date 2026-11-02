\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.dealer_swing_operator_requests WHERE request_id='e52c4f40-3a7b-4480-998f-4961fbd8ba17' AND actor_user_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND expected_version=1 AND response->>'outcome'='swung' AND response->>'new_assignment_id'='e70ae2f2-3aef-40d7-b8b3-37fda915d2fd' AND response->>'rotation_completion'='executed');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='e70ae2f2-3aef-40d7-b8b3-37fda915d2fd' AND table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND attendance_id='e03c9a69-7c3d-4431-aa98-a801015dfae5' AND status='assigned' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='cbf19368-cf31-492c-8616-1e5b0a122191' AND status='completed' AND released_at IS NOT NULL);
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND status='assigned' AND released_at IS NULL)=1;
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='905d5b94-c855-4da4-ad82-4cf50e3a965a' AND status='executed');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='808821c8-7611-424e-934a-9ce262af139a' AND status='assigned' AND table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='47323bd1-60a3-42a8-99c6-ede1c33f5f90' AND status='checked_in' AND current_state='available' AND last_released_at IS NOT NULL AND check_out_time IS NULL);
 ASSERT (SELECT count(*)=8 AND sum(chip_count)=160000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);
 ASSERT (SELECT count(*)=8 AND sum(applied_amount)=800000 FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE receipt jsonb; BEGIN
 receipt:=public.get_dealer_manual_swing_receipt_v1('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',1,'e52c4f40-3a7b-4480-998f-4961fbd8ba17');
 ASSERT receipt->>'status'='receipt_found' AND receipt->'response'->>'new_assignment_id'='e70ae2f2-3aef-40d7-b8b3-37fda915d2fd';
END $$;
ROLLBACK;
SELECT 'SINGLE661_ACTUAL_SWING_RECEIPT_NEW_SESSION_BINDING_CONSERVATION_PASS';
