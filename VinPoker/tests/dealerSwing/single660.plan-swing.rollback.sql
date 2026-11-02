\set ON_ERROR_STOP on
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
END $$;
CREATE TEMP VIEW single660_fingerprint AS SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_rotation_schedule a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY request_id) FROM public.dealer_swing_operator_requests a)
)::text) value;
CREATE TEMP TABLE single660_before AS SELECT value FROM single660_fingerprint;
BEGIN;
SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';
CREATE TEMP TABLE single660_time AS SELECT id,check_in_time,check_out_time,total_worked_minutes_today,overtime_minutes
 FROM public.dealer_attendance WHERE id IN('47323bd1-60a3-42a8-99c6-ede1c33f5f90','e03c9a69-7c3d-4431-aa98-a801015dfae5');
CREATE TEMP TABLE single660_payroll AS SELECT id,public.calculate_dealer_payroll(id,current_date,current_date,0) value
 FROM public.dealers WHERE id IN('e6420000-0000-4000-8000-000000000001','e6420000-0000-4000-8000-000000000002');
CREATE TEMP TABLE single660_result(plan jsonb,swing jsonb);
GRANT SELECT,INSERT,UPDATE ON single660_result TO authenticated;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE plan jsonb; replay jsonb; result jsonb; receipt jsonb; BEGIN
 plan:=public.operator_plan_next_dealer_v1('b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',0,'e03c9a69-7c3d-4431-aa98-a801015dfae5','e6600000-0000-4000-8000-000000000001');
 ASSERT plan->>'outcome'='changed',plan::text;
 replay:=public.operator_plan_next_dealer_v1('b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',0,'e03c9a69-7c3d-4431-aa98-a801015dfae5','e6600000-0000-4000-8000-000000000001');
 ASSERT replay=plan,'same plan key must return saved plan';
 replay:=public.operator_plan_next_dealer_v1('b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',0,'1f3f1e56-db9d-46b9-9e3b-531845da5802','e6600000-0000-4000-8000-000000000001');
 ASSERT replay->>'outcome'='idempotency_conflict',replay::text;
 result:=public.operator_perform_swing_v2('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',1,'e6600000-0000-4000-8000-000000000002');
 ASSERT result->>'outcome'='swung',result::text;
 ASSERT result->>'rotation_completion'='executed',result::text;
 receipt:=public.get_dealer_manual_swing_receipt_v1('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',1,'e6600000-0000-4000-8000-000000000002');
 ASSERT receipt->>'status'='receipt_found' AND receipt->'response'=result,receipt::text;
 replay:=public.operator_perform_swing_v2('febf2b51-fdb7-42ff-886c-b3bb1fffdc3e','d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','cbf19368-cf31-492c-8616-1e5b0a122191',1,'e6600000-0000-4000-8000-000000000002');
 ASSERT replay-'idempotent'=result AND replay->>'idempotent'='true',replay::text;
 INSERT INTO single660_result VALUES(plan,result);
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments a,single660_result r WHERE a.id=(r.swing->>'new_assignment_id')::uuid AND a.table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND a.attendance_id='e03c9a69-7c3d-4431-aa98-a801015dfae5' AND a.status='assigned' AND a.released_at IS NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='cbf19368-cf31-492c-8616-1e5b0a122191' AND status='completed' AND released_at IS NOT NULL);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='47323bd1-60a3-42a8-99c6-ede1c33f5f90' AND current_state='available' AND last_released_at=now() AND check_out_time IS NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM single660_time b JOIN public.dealer_attendance a USING(id) WHERE ROW(a.check_in_time,a.check_out_time,a.total_worked_minutes_today,a.overtime_minutes) IS DISTINCT FROM ROW(b.check_in_time,b.check_out_time,b.total_worked_minutes_today,b.overtime_minutes));
 ASSERT NOT EXISTS(SELECT 1 FROM single660_payroll b WHERE b.value IS DISTINCT FROM public.calculate_dealer_payroll(b.id,current_date,current_date,0));
 ASSERT (SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5' AND status='assigned' AND released_at IS NULL)=1;
 ASSERT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE id='808821c8-7611-424e-934a-9ce262af139a' AND table_session_id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND status='assigned' AND released_at IS NULL);
 ASSERT (SELECT auto_swing_enabled=false FROM public.club_settings WHERE club_id='d4427834-5f5f-48ef-bde5-e2dc388ed00b');
END $$;
SELECT plan,swing FROM single660_result;
ROLLBACK;
DO $$ BEGIN ASSERT (SELECT b.value=f.value FROM single660_before b CROSS JOIN single660_fingerprint f),'rollback must preserve retained journey'; END $$;
SELECT 'SINGLE660_SAME_TOUR_PLAN_SWING_RECEIPT_PAYROLL_ROLLBACK_PASS';
