-- Append to operationalInventory.pg17.sql. Synthetic TEST metadata; canonical
-- Floor open/close and manual-intent exact-session assignment. Everything rolls back.
RESET ROLE;
INSERT INTO public.club_settings(club_id,auto_swing_enabled)
 VALUES('e1700000-0000-4000-8000-000000000002',false);
DO $test$
DECLARE n integer; physical uuid; dealer uuid; attendance uuid; opened jsonb; assigned jsonb;
BEGIN
 FOR n IN 1..40 LOOP
  physical:=gen_random_uuid();dealer:=gen_random_uuid();attendance:=gen_random_uuid();
  INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
   VALUES(physical,'e1700000-0000-4000-8000-000000000002','Tournament projection capacity TEST '||n,4+n,'tournament','inactive','available');
  INSERT INTO public.dealers(id,club_id,full_name,status)
   VALUES(dealer,'e1700000-0000-4000-8000-000000000002','Tournament projection dealer TEST '||n,'active');
  INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
   VALUES(attendance,dealer,'e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"sub":"e1700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3('e1700000-0000-4000-8000-000000000003',physical,'manual',gen_random_uuid());
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(opened->>'ok'='true','canonical tournament open: '||opened::text);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('role','service_role',true);
  assigned:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',physical,
   (opened->>'table_session_id')::uuid,attendance,now()+interval '30 minutes','tournament-projection-'||physical);
  PERFORM set_config('role','none',true);
  PERFORM pg_temp.assert_true(assigned->>'outcome'='ok','canonical tournament assignment: '||assigned::text);
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT count(*)=40 AND bool_and(tt.table_id IS NULL)
  FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id
  WHERE tt.tournament_id='e1700000-0000-4000-8000-000000000003' AND tt.status='active'
   AND s.closed_at IS NULL AND s.game_table_id=tt.game_table_id AND s.session_type='tournament'),
  'forty canonical tournament links, no fabricated legacy table_id');
END $test$;

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"e1700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $test$ DECLARE n integer; started timestamptz; samples double precision[]:='{}'; rows_read integer; BEGIN
 FOR n IN 1..20 LOOP
  started:=clock_timestamp();
  SELECT count(*) INTO rows_read FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002');
  samples:=array_append(samples,extract(epoch FROM clock_timestamp()-started)*1000);
  PERFORM pg_temp.assert_true(rows_read=41,'forty tournament plus one cash assignment, not legacy/orphan markers');
 END LOOP;
 PERFORM pg_temp.assert_true((SELECT count(*)=41 AND count(DISTINCT table_id)=41
  FROM public.predict_next_dealers('e1700000-0000-4000-8000-000000000002')),'legacy alias same mixed operational pool');
 PERFORM pg_temp.assert_true((SELECT count(*)=40 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002') p
  JOIN public.tournament_tables tt ON tt.game_table_id=p.table_id AND tt.status='active'
  WHERE tt.tournament_id='e1700000-0000-4000-8000-000000000003'),'exactly forty predictions map to canonical tournament tables');
 PERFORM set_config('test.tournament_prediction_capacity',jsonb_build_object('tournamentTables',40,'cashTables',1,'samplesMs',samples,
  'p95Ms',(SELECT x FROM unnest(samples) x ORDER BY x OFFSET 18 LIMIT 1),'maxMs',(SELECT max(x) FROM unnest(samples) x))::text,true);
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_true((SELECT count(*)=41 FROM public.get_dealer_operational_tables_v1('e1700000-0000-4000-8000-000000000002')),
 'worker inventory agrees with predictions at mixed capacity');
RESET ROLE;

DO $test$
DECLARE target record; closed jsonb; reopened jsonb; assigned jsonb; fresh_dealer uuid:=gen_random_uuid();fresh_attendance uuid:=gen_random_uuid();
BEGIN
 SELECT tt.id,tt.game_table_id,tt.table_session_id,s.revision,a.id AS assignment_id INTO STRICT target
 FROM public.tournament_tables tt JOIN public.table_sessions s ON s.id=tt.table_session_id
 JOIN public.dealer_assignments a ON a.table_session_id=s.id AND a.released_at IS NULL
 WHERE tt.tournament_id='e1700000-0000-4000-8000-000000000003' AND tt.status='active' ORDER BY tt.table_number LIMIT 1;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('role','authenticated',true);
 closed:=public.close_tournament_table_v4(target.id,target.revision,gen_random_uuid());
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true(closed->>'ok'='true','close empty assigned tournament table: '||closed::text);
 PERFORM pg_temp.assert_true((SELECT released_at IS NOT NULL FROM public.dealer_assignments WHERE id=target.assignment_id),
  'exact old assignment retained/released');
 PERFORM set_config('role','authenticated',true);
 reopened:=public.floor_open_tournament_table_v3('e1700000-0000-4000-8000-000000000003',target.game_table_id,'manual',gen_random_uuid());
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true(reopened->>'ok'='true' AND (reopened->>'table_session_id')::uuid<>target.table_session_id,
  'reopen creates a new incarnation: '||reopened::text);
 PERFORM set_config('role','authenticated',true);
 PERFORM pg_temp.assert_true((SELECT count(*)=40 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),
  'new unassigned session cannot revive the released previous-session prediction');
 PERFORM set_config('role','none',true);
 INSERT INTO public.dealers(id,club_id,full_name,status)
  VALUES(fresh_dealer,'e1700000-0000-4000-8000-000000000002','Fresh tournament incarnation TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
  VALUES(fresh_attendance,fresh_dealer,'e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
 PERFORM set_config('request.jwt.claim.role','service_role',true);PERFORM set_config('role','service_role',true);
 assigned:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',target.game_table_id,
  target.table_session_id,fresh_attendance,now()+interval '30 minutes','old-tournament-session-'||target.table_session_id);
 PERFORM pg_temp.assert_true(assigned->>'outcome'='table_session_changed','stale session cannot take fresh attendance');
 assigned:=public.worker_assign_dealer_to_session_v1('e1700000-0000-4000-8000-000000000002',target.game_table_id,
  (reopened->>'table_session_id')::uuid,fresh_attendance,now()+interval '30 minutes','new-tournament-session-'||target.table_session_id);
 PERFORM set_config('role','none',true);
 PERFORM pg_temp.assert_true(assigned->>'outcome'='ok','new exact incarnation accepts fresh TEST attendance');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_assignments WHERE table_id=target.game_table_id
  AND released_at IS NULL AND table_session_id=(reopened->>'table_session_id')::uuid),'only new-session assignment active');
END $test$;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=41 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),
 'prediction count recovers after canonical close/reopen/manual assignment');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='e1700000-0000-4000-8000-000000000002' AND auto_swing_enabled),'auto remains OFF');
SELECT 'PREDICTION_TOURNAMENT40_MIXED_POOL_CLOSE_REOPEN_ROLLBACK_PASS '||current_setting('test.tournament_prediction_capacity');
