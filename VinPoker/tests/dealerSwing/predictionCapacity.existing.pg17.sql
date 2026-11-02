-- Append to the existing operational fixture. All state rolls back.
RESET ROLE;
DO $test$ DECLARE n integer; physical uuid;session_id uuid;dealer uuid;attendance uuid;receipt jsonb;
BEGIN
 FOR n IN 1..39 LOOP
  physical:=gen_random_uuid();session_id:=gen_random_uuid();dealer:=gen_random_uuid();attendance:=gen_random_uuid();
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
   VALUES(physical,'e1700000-0000-4000-8000-000000000002','Projection capacity TEST '||n,4+n,'cash','inactive','available');
  INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
   VALUES(session_id,'e1700000-0000-4000-8000-000000000002',physical,'cash','manual',1,1,'e1700000-0000-4000-8000-000000000001');
  INSERT INTO public.dealers(id,club_id,full_name,status)
   VALUES(dealer,'e1700000-0000-4000-8000-000000000002','Projection dealer TEST '||n,'active');
  INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
   VALUES(attendance,dealer,'e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
  PERFORM set_config('role','service_role',true);
  receipt:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',physical,session_id,attendance,now()+interval '30 minutes','prediction-load-'||session_id);
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(receipt->>'outcome'='ok','capacity assignment exact canonical session');
 END LOOP;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e1700000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"e1700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $test$ DECLARE n integer;started timestamptz;samples double precision[]:='{}';rows_read integer;BEGIN
 FOR n IN 1..20 LOOP
  started:=clock_timestamp();
  SELECT count(*) INTO rows_read FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002');
  samples:=array_append(samples,extract(epoch FROM clock_timestamp()-started)*1000);
  PERFORM pg_temp.assert_true(rows_read=40,'every read returns all forty eligible table sessions');
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT count(*)=40 AND count(DISTINCT table_id)=40 FROM public.predict_next_dealers('e1700000-0000-4000-8000-000000000002')),'legacy alias same forty unique tables');
 PERFORM set_config('test.prediction_capacity',jsonb_build_object('tables',40,'samplesMs',samples,
  'p95Ms',(SELECT x FROM unnest(samples) x ORDER BY x OFFSET 18 LIMIT 1),
  'maxMs',(SELECT max(x) FROM unnest(samples) x))::text,true);
END $test$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=40 AND count(DISTINCT table_session_id)=40 AND count(DISTINCT attendance_id)=40
 FROM public.dealer_assignments WHERE club_id='e1700000-0000-4000-8000-000000000002' AND status='assigned' AND released_at IS NULL),'no duplicate assignment/session/dealer at capacity');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='e1700000-0000-4000-8000-000000000002' AND auto_swing_enabled),'auto never enabled');
SELECT 'PREDICTION_CAPACITY40_LOCAL_PASS '||current_setting('test.prediction_capacity');
