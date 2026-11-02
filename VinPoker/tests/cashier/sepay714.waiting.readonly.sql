\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE reg uuid:='158c5c8b-7a66-47b5-b728-ec854a7b09c8'; tour uuid:='58aa8ad3-3c86-4163-9c27-6303943b96d5'; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id=tour AND club_id='08b5d92e-591a-4351-9382-60f1e5b93cf3' AND name='Cash identity local TEST');
 ASSERT (SELECT count(*)=100 AND count(DISTINCT table_number)=100 AND min(table_number)=1 AND max(table_number)=100
  FROM public.game_tables WHERE club_id='08b5d92e-591a-4351-9382-60f1e5b93cf3');
 ASSERT (SELECT count(*)=3 FROM public.tournament_entries WHERE tournament_id=tour);
 ASSERT (SELECT sum(applied_amount)=300000 FROM public.cashier_buyin_movements WHERE tournament_id=tour);
 ASSERT (SELECT count(*)=2 AND sum(applied_amount)=100000 FROM public.cashier_buyin_movements WHERE registration_id=reg);
 ASSERT (SELECT count(*)=1 FROM public.tournament_entries WHERE registration_id=reg);
 ASSERT (SELECT count(*)=1 FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id WHERE e.registration_id=reg AND s.is_active);
 ASSERT (SELECT count(*)=1 FROM public.seat_draw_receipts WHERE registration_id=reg AND status='issued');
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE data->>'registration_id'=reg::text AND data ? 'receipt_code');
 ASSERT (SELECT count(*)=1 FROM public.tournament_hands WHERE tournament_id=tour AND status='in_progress');
 ASSERT (SELECT count(*)=2 AND sum(starting_stack)=40000 FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id WHERE h.tournament_id=tour AND h.status='in_progress');
 ASSERT md5(pg_get_functiondef('auth.uid()'::regprocedure))='ce65cb9cec793a1d137d8fca81a8f141';
 ASSERT md5(pg_get_functiondef('net.http_post(text,jsonb,jsonb,jsonb,integer)'::regprocedure))='527bf53146f37a72fc9ba50c1a83f1f3';
 ASSERT NOT EXISTS(SELECT 1 FROM public.sepay_system_settings);
 ASSERT NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'sepay_test_%');
END $$;
ROLLBACK;
SELECT 'SEPAY714_RETAINED_HANDLER_WAIT_OPEN_SEAT_ONCE_100_TABLES_FROZEN_TWO_PLAYER_HAND_AUTH_SINK_RESTORED_PASS';
