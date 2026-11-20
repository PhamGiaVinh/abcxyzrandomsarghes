-- Extends the disposable Chip Ops history fixture after its read-only check.
BEGIN;
DO $$
DECLARE
  club uuid := 'a2000000-0000-4000-8000-000000000001';
  flight uuid := 'bd200000-0000-4000-8000-000000000201';
  final uuid := gen_random_uuid();
  event uuid := gen_random_uuid();
  physical uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  tournament_table uuid := gen_random_uuid();
  registration uuid := gen_random_uuid();
  entry uuid := gen_random_uuid();
  actor uuid;
  player uuid;
  dealer uuid := gen_random_uuid();
  shift_id uuid := gen_random_uuid();
  attendance_id uuid := gen_random_uuid();
  receipt jsonb;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=club AND c.name='Cashier Edge TEST');
  ASSERT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id=flight
    AND t.club_id=club AND t.name='Chip history TEST 201' AND t.event_id IS NULL);
  SELECT owner_id INTO STRICT actor FROM public.clubs WHERE id=club;
  SELECT id INTO STRICT player FROM auth.users WHERE email='cashier-latency-19@test.invalid';
  INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
    VALUES(shift_id,club,'Chip history bagging TEST','00:00','23:59');
  INSERT INTO public.dealers(id,club_id,full_name,status)
    VALUES(dealer,club,'Chip history dealer TEST','active');
  INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
    VALUES(attendance_id,dealer,shift_id,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'checked_in',now(),'assigned');

  INSERT INTO public.tournaments(id,club_id,name,status,live_status,phase,buy_in,starting_stack)
    VALUES(final,club,'Chip history final TEST','active','registering','final',100000,20000);
  INSERT INTO public.tournament_events(id,club_id,name,final_tournament_id,itm_percent,buy_in,rake_amount)
    VALUES(event,club,'Chip history event TEST',final,100,100000,0);
  UPDATE public.tournaments SET event_id=event WHERE id=final;
  UPDATE public.tournaments SET phase='flight',event_id=event,flight_label='A',starting_stack=20000 WHERE id=flight;
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
    SELECT physical,club,'Chip history physical TEST',COALESCE(max(table_number),0)+1,'tournament','active','available'
    FROM public.game_tables WHERE club_id=club;
  INSERT INTO public.table_sessions(id,club_id,game_table_id,tournament_id,session_type,control_mode,control_epoch,revision)
    VALUES(session_id,club,physical,flight,'tournament','tracker',1,1);
  INSERT INTO public.tournament_tables(id,tournament_id,game_table_id,table_session_id,status)
    VALUES(tournament_table,flight,physical,session_id,'active');
  INSERT INTO public.dealer_assignments(attendance_id,dealer_id,club_id,table_id,table_session_id,status,assigned_at,swing_due_at,version)
    VALUES(attendance_id,dealer,club,physical,session_id,'assigned',now(),now()+interval '30 min',0);
  INSERT INTO public.tournament_registrations(id,tournament_id,club_id,player_id,buy_in,status)
    VALUES(registration,flight,club,player,100000,'confirmed');
  INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,source,status,starting_stack,current_stack)
    VALUES(entry,flight,registration,player,1,'buy_in','seated',20000,20000);
  INSERT INTO public.tournament_seats(tournament_id,player_id,entry_id,entry_number,table_id,tournament_table_id,table_session_id,seat_number,is_active,chip_count)
    VALUES(flight,player,entry,1,physical,tournament_table,session_id,1,true,20000);
  INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count,updated_at)
    VALUES(flight,player,1,20000,now());
  UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY[club] WHERE id;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  receipt := public.multi_day_end_flight_v1(flight,1,gen_random_uuid());
  ASSERT receipt->>'status'='bagging' AND receipt->>'rosterCount'='1', 'End Flight did not freeze one player';
END $$;
COMMIT;
