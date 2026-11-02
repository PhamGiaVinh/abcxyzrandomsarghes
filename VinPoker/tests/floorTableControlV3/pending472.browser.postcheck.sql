-- Checkpoint472 snapshot BEFORE worker473. Its queue=pending assertion is
-- historical; after473 use trackerSettlement/history473.hand33.readonly.sql.
-- After browser477 current seats changed to58900/1100; these seat assertions
-- are also historical. Use handinput/hand477.browser.postcheck.sql for that snapshot.
BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='65e9cd23-c25e-4491-9c46-9b01c79676cf'
  AND hand_number=33 AND status='completed' AND pot_size=200 AND source_revision=9 AND NOT is_voided);
 ASSERT (SELECT count(*) FROM public.hand_actions WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf')=3;
 ASSERT (SELECT sum(starting_stack)=60000 AND sum(ending_stack)=60000 FROM public.hand_players WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND is_active AND seat_number=1 AND chip_count=58700);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats WHERE table_session_id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND is_active AND seat_number=2 AND chip_count=1300);
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc'
  AND control_mode='tracker' AND control_epoch=12 AND revision=16 AND closed_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf' AND source_revision=9 AND status='pending');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf' AND source_revision<9 AND status<>'cancelled');
 ASSERT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE actor_id='675fe35e-60a8-4452-bb90-e79486d54da6'
  AND operation_type='record_tracker_manual_hand_v1' AND request_id='be1cd666-bbb5-4d2a-91c3-cbcfe5623a53'
  AND result->>'hand_id'='65e9cd23-c25e-4491-9c46-9b01c79676cf' AND result->>'status'='success'
  AND (result->>'committed_source_revision')::bigint=9 AND (result->>'ending_total')::bigint=60000);
 RAISE NOTICE 'FLOOR472_BROWSER_PENDING_FINISH_CONSERVATION_CURRENT_QUEUE_POSTCHECK_PASS';
END $$;
ROLLBACK;
