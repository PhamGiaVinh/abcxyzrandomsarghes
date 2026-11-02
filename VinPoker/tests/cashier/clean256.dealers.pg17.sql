-- Fresh declarative TEST identities only. Actual check-in happens through UI/RPC.
BEGIN;
DO $$ DECLARE club uuid:='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 shift uuid:=gen_random_uuid(); dealer uuid; ids uuid[]:='{}'; fingerprint text; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT inet_server_port()=55441 AND inet_server_addr()='127.0.0.1'::inet;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealers WHERE club_id=club);
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_shifts WHERE club_id=club);
 ASSERT NOT EXISTS(SELECT 1 FROM public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682 WHERE fixture?'dealers');
 ASSERT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id
  JOIN public.club_settings s ON s.club_id=c.id WHERE t.id='c367013a-3ed3-48af-ad48-3915acadc50e'
   AND c.id=club AND c.owner_id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e' AND NOT s.auto_swing_enabled);
 SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text) INTO fingerprint;
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
 VALUES(shift,club,'Clean R11 TEST shift','08:00','23:00');
 FOR i IN 1..4 LOOP
  dealer:=gen_random_uuid();ids:=array_append(ids,dealer);
  INSERT INTO public.dealers(id,club_id,full_name,status)
  VALUES(dealer,club,'Clean R11 TEST dealer '||i,'active');
 END LOOP;
 UPDATE public.clean244_fixture_641c3e81f65f4e76ab90c7b8237b8682
 SET fixture=fixture||jsonb_build_object('dealers',to_jsonb(ids),'dealerShift',shift);
 ASSERT fingerprint=md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x))::text);
 RAISE NOTICE 'CLEAN256_FOUR_TEST_DEALERS_SHIFT_METADATA_ONLY_NO_ATTENDANCE % %',ids,shift;
END $$;
COMMIT;
