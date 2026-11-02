\set ON_ERROR_STOP on
BEGIN READ ONLY;SET LOCAL statement_timeout='10s';
DO $$ DECLARE row record;BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 FOR row IN SELECT * FROM(VALUES
 ('47323bd1-60a3-42a8-99c6-ede1c33f5f90'::uuid,'2026-10-24T09:53:49.584198+07'::timestamptz),
 ('e03c9a69-7c3d-4431-aa98-a801015dfae5'::uuid,'2026-10-24T13:13:21.691889+07'::timestamptz),
 ('6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a'::uuid,'2026-10-24T11:40:15.021818+07'::timestamptz))v(id,ended) LOOP
  ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance a WHERE a.id=row.id AND a.status='checked_out' AND a.current_state='checked_out' AND a.check_out_time=row.ended AND a.total_worked_minutes_today=0 AND a.overtime_minutes=0);
  ASSERT (SELECT count(*)=1 AND bool_and(payload->>'evidence_at'=to_jsonb(row.ended)#>>'{}' AND payload->>'payroll_recalculated'='false' AND payload->>'overtime_recalculated'='false')
   FROM public.audit_logs WHERE action='administrative_stale_checkout' AND entity_id::text=row.id::text);
 END LOOP;
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND status='checked_in' AND current_state='available' AND check_out_time IS NULL AND total_worked_minutes_today=0 AND overtime_minutes=0);
 ASSERT NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action='administrative_stale_checkout' AND entity_id::text='1f3f1e56-db9d-46b9-9e3b-531845da5802');
 ASSERT NOT EXISTS(SELECT 1 FROM public.payroll_periods WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_payroll WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$ DECLARE report jsonb;row record;dealer jsonb;BEGIN
 report:=public.calculate_club_payroll('d4427834-5f5f-48ef-bde5-e2dc388ed00b','2026-10-01','2026-10-31');
 FOR row IN SELECT * FROM(VALUES
 ('e6420000-0000-4000-8000-000000000001',2.03),('e6420000-0000-4000-8000-000000000002',5.36),
 ('e6420000-0000-4000-8000-000000000003',3.81),('e6420000-0000-4000-8000-000000000004',8.00))v(id,hours) LOOP
  dealer:=report->'dealers'->row.id;
  ASSERT (dealer->>'total_hours')::numeric=row.hours AND (dealer->>'net_pay_vnd')::numeric=0 AND (dealer->>'ot_hours')::numeric=0;
 END LOOP;
END $$;
RESET ROLE;ROLLBACK;
SELECT 'SINGLE804_THREE_EVIDENCED_CLOSED_AUDITS_NO_WORKED_OT_REWRITE_ONE_UNRESOLVED_STANDARD_ESTIMATE_NO_FINAL_PAYROLL_PASS';
