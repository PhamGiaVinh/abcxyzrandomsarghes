\set ON_ERROR_STOP on
CREATE TEMP TABLE single637_financial AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text) facts;
CREATE TEMP TABLE single637_before AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY entry_id) FROM public.seat_draw_receipts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text) facts;
BEGIN;
SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*) FROM public.tournament_tables WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND status='active')=2;
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')=8;
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;again jsonb;BEGIN
 r:=public.confirm_registration_and_assign_seat('df79ea5e-ef9f-4ef6-a27c-ed53d5486a67',auth.uid(),'random_balanced');
 RAISE NOTICE 'SINGLE637_CONFIRM_PAID_WAITING_RESULT %',r;
 ASSERT r->>'ok'='true' AND (r->>'starting_stack')::bigint=20000,r::text;
 IF r->>'ok'='true' THEN
  again:=public.confirm_registration_and_assign_seat('df79ea5e-ef9f-4ef6-a27c-ed53d5486a67',auth.uid(),'random_balanced');
  RAISE NOTICE 'SINGLE637_REPLAY_RESULT %',again;
  ASSERT again->>'ok'='true' AND again->>'idempotent'='true' AND again->>'entry_id'=r->>'entry_id'
   AND again->>'seat_id'=r->>'seat_id' AND again->>'receipt_id'=r->>'receipt_id',again::text;
 END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e')=1;
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active AND chip_count=20000)=1;
 ASSERT (SELECT facts FROM single637_financial)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text);
END $$;
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT facts FROM single637_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY entry_id) FROM public.seat_draw_receipts x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text);
END $$;
SELECT 'SINGLE637_PAID_SEAT_REPLAY_NO_EXTRA_CASH_CHIP_ATTENDANCE_FULL_ROLLBACK_PASS';
