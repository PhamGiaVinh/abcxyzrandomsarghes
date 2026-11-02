\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT count(*)=4 AND bool_and(status='checked_in' AND current_state='available' AND check_out_time IS NULL
  AND total_worked_minutes_today=0 AND overtime_minutes=0 AND pre_assigned_at IS NULL AND pre_assigned_table_id IS NULL)
  FROM public.dealer_attendance WHERE dealer_id IN('e6420000-0000-4000-8000-000000000001','e6420000-0000-4000-8000-000000000002','e6420000-0000-4000-8000-000000000003','e6420000-0000-4000-8000-000000000004'));
 ASSERT (SELECT count(*)=3 AND bool_and(closed_at IS NOT NULL) FROM public.table_sessions WHERE id IN
  ('b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','0aab12d1-b855-4014-9f22-1dc59719c7e2','f60106c2-7ed5-4be3-8512-602b16eddff3'));
 ASSERT (SELECT count(*)=4 AND bool_and(status='completed' AND released_at IS NOT NULL AND pre_assigned_attendance_id IS NULL OR
  id='cbf19368-cf31-492c-8616-1e5b0a122191' AND status='completed' AND released_at IS NOT NULL)
  FROM public.dealer_assignments WHERE table_session_id IN
  ('b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','0aab12d1-b855-4014-9f22-1dc59719c7e2','f60106c2-7ed5-4be3-8512-602b16eddff3'));
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='905d5b94-c855-4da4-ad82-4cf50e3a965a' AND status='executed');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='cancelled' AND reason->>'cancel_reason'='table_session_closed');
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_payroll WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE report jsonb;id uuid;row jsonb;BEGIN
 report:=public.calculate_club_payroll('d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-01','2026-10-31');
 ASSERT report->>'club_id'='d4427834-5f5f-48ef-bde5-e2dc388ed00b' AND report->>'period_start'='2026-10-01' AND report->>'period_end'='2026-10-31';
 FOREACH id IN ARRAY ARRAY['e6420000-0000-4000-8000-000000000001'::uuid,'e6420000-0000-4000-8000-000000000002'::uuid,
  'e6420000-0000-4000-8000-000000000003'::uuid,'e6420000-0000-4000-8000-000000000004'::uuid] LOOP
  row:=report->'dealers'->id::text;
  ASSERT row IS NOT NULL AND row->>'dealer_id'=id::text AND (row->>'total_shifts')::numeric=1;
  ASSERT (row->>'total_hours')::numeric=8 AND (row->>'ot_hours')::numeric=0 AND (row->>'net_pay_vnd')::numeric=0;
  ASSERT row->>'employment_type'='full_time' AND (row->>'monthly_salary_vnd')::numeric=0;
  ASSERT jsonb_array_length(row->'shifts')=1 AND row->'shifts'->0->'check_out_time'='null'::jsonb
   AND (row->'shifts'->0->>'total_worked_minutes')::numeric=0;
 END LOOP;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';
SET LOCAL request.jwt.claims='{"sub":"40b8f243-bf3b-4aaa-962b-db788380207c","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.calculate_club_payroll('d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-01','2026-10-31');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 ASSERT denied,'owner of another TEST club must not read this payroll';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'SINGLE705_CLOSED_ASSIGNMENTS_CANCELLED_RESERVATION_FOUR_OPEN_STANDARD8H_ESTIMATES_NO_FINAL_PAYROLL_OWNER_ONLY_PASS';
