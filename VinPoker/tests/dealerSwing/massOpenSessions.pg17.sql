\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'mass_open_test_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('e1800000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1800000-0000-4000-8000-000000000002','e1800000-0000-4000-8000-000000000001','Mass open TEST','TEST');
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
VALUES('e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000002','Fresh TEST',91,'cash','inactive','available'),
 ('e1800000-0000-4000-8000-000000000012','e1800000-0000-4000-8000-000000000002','Tournament requires Floor TEST',92,'tournament','inactive','available'),
 ('e1800000-0000-4000-8000-000000000013','e1800000-0000-4000-8000-000000000002','Staffed inactive marker TEST',93,'cash','inactive','available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by)
VALUES('e1800000-0000-4000-8000-000000000023','e1800000-0000-4000-8000-000000000002','e1800000-0000-4000-8000-000000000013','cash','manual',1,1,'e1800000-0000-4000-8000-000000000001');
INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
VALUES('e1800000-0000-4000-8000-000000000030','e1800000-0000-4000-8000-000000000002','TEST','08:00','23:00');
INSERT INTO public.dealers(id,club_id,full_name,status)
VALUES('e1800000-0000-4000-8000-000000000031','e1800000-0000-4000-8000-000000000002','TEST dealer','active'),
 ('e1800000-0000-4000-8000-000000000032','e1800000-0000-4000-8000-000000000002','Staffed TEST dealer','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
VALUES('e1800000-0000-4000-8000-000000000041','e1800000-0000-4000-8000-000000000031','e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available'),
 ('e1800000-0000-4000-8000-000000000042','e1800000-0000-4000-8000-000000000032','e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'assigned');
INSERT INTO public.dealer_assignments(attendance_id,dealer_id,club_id,table_id,table_session_id,status)
VALUES('e1800000-0000-4000-8000-000000000042','e1800000-0000-4000-8000-000000000032','e1800000-0000-4000-8000-000000000002','e1800000-0000-4000-8000-000000000013','e1800000-0000-4000-8000-000000000023','assigned');
INSERT INTO public.dealer_mass_open_rollout(id,enabled,all_clubs_enabled,allowed_club_ids)
VALUES(true,true,false,ARRAY['e1800000-0000-4000-8000-000000000002'::uuid])
ON CONFLICT(id) DO UPDATE SET enabled=true,all_clubs_enabled=false,allowed_club_ids=EXCLUDED.allowed_club_ids;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000050','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000011'::uuid,'e1800000-0000-4000-8000-000000000013'::uuid],'cash');
SELECT pg_temp.assert_true((public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000050','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000011'::uuid,'e1800000-0000-4000-8000-000000000013'::uuid],'cash')->>'idempotent_replay')::boolean,'same request replay');
SELECT pg_temp.assert_true(public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000050','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000011'::uuid,'e1800000-0000-4000-8000-000000000013'::uuid],'vip')->>'outcome'='idempotency_conflict','changed payload conflicts');
SELECT pg_temp.assert_true(public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000051','e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000012'::uuid],'tournament')->>'reason'='open_tournament_in_floor','never guess tournament from dealer shift');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='active' FROM public.game_tables WHERE id='e1800000-0000-4000-8000-000000000013'),'staffed compatibility marker converges');
SELECT pg_temp.assert_true((SELECT status<>'cancelled' FROM public.dealer_open_operations WHERE id='e1800000-0000-4000-8000-000000000050'),'mixed operation not falsely cancelled');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.table_sessions WHERE game_table_id='e1800000-0000-4000-8000-000000000011' AND closed_at IS NULL),'one canonical session created');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.get_dealer_operational_tables_v1('e1800000-0000-4000-8000-000000000002')),'worker sees newly opened canonical table');
SELECT pg_temp.assert_true((SELECT public.worker_assign_dealer_to_session_v1('e1800000-0000-4000-8000-000000000002',id,table_session_id,'e1800000-0000-4000-8000-000000000041',now()+interval '45 minutes','mass-open-test-assign')->>'outcome'='ok'
 FROM public.get_dealer_operational_tables_v1('e1800000-0000-4000-8000-000000000002') WHERE id='e1800000-0000-4000-8000-000000000011'),'worker commits exact-session assignment');
SELECT pg_temp.assert_true((SELECT public.worker_read_initial_assignment_receipt_v1('mass-open-test-assign','e1800000-0000-4000-8000-000000000002',id,table_session_id,'e1800000-0000-4000-8000-000000000031')->>'outcome'='ok' FROM public.get_dealer_operational_tables_v1('e1800000-0000-4000-8000-000000000002') WHERE id='e1800000-0000-4000-8000-000000000011'),'unknown outcome reconciles stored commit');
SELECT pg_temp.assert_true(public.worker_read_initial_assignment_receipt_v1('mass-open-test-assign','e1800000-0000-4000-8000-000000000002','e1800000-0000-4000-8000-000000000011','e1800000-0000-4000-8000-000000000098','e1800000-0000-4000-8000-000000000031')->>'outcome'='idempotency_mismatch','old request cannot cross session');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.worker_read_initial_assignment_receipt_v1(text,uuid,uuid,uuid,uuid)','EXECUTE'),'browser cannot read internal receipts');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id WHERE a.table_id='e1800000-0000-4000-8000-000000000011' AND s.closed_at IS NULL AND a.released_at IS NULL),'one committed assignment for opened incarnation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE game_table_id='e1800000-0000-4000-8000-000000000012'),'rejected tournament does not open a session');
-- Isolated 40-table capacity seam. All fixture data remains in this transaction.
CREATE TEMP TABLE scale40 AS SELECT n,
  md5('scale40-table-'||n)::uuid AS table_id,
  md5('scale40-dealer-'||n)::uuid AS dealer_id,
  md5('scale40-attendance-'||n)::uuid AS attendance_id
FROM generate_series(1,40) n;
GRANT SELECT ON scale40 TO authenticated,service_role;
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
SELECT table_id,'e1800000-0000-4000-8000-000000000002','Scale TEST '||n,n,'cash','inactive','available' FROM scale40;
INSERT INTO public.dealers(id,club_id,full_name,status)
SELECT dealer_id,'e1800000-0000-4000-8000-000000000002','Scale TEST dealer '||n,'active' FROM scale40;
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
SELECT attendance_id,dealer_id,'e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available' FROM scale40;
INSERT INTO public.club_settings(club_id,auto_swing_enabled)
VALUES('e1800000-0000-4000-8000-000000000002',true)
ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=true;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000060',
 'e1800000-0000-4000-8000-000000000002',null,(SELECT array_agg(table_id ORDER BY n) FROM scale40),'cash');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=40 FROM public.table_sessions s JOIN scale40 x ON x.table_id=s.game_table_id WHERE s.closed_at IS NULL),'40 distinct active sessions');
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
SELECT set_config('request.headers','{}',true);
DO $scale$
DECLARE r record; result jsonb;
BEGIN
 FOR r IN SELECT x.*,s.table_session_id FROM scale40 x JOIN public.get_dealer_operational_tables_v1('e1800000-0000-4000-8000-000000000002') s ON s.id=x.table_id ORDER BY x.n LOOP
  result:=public.worker_assign_dealer_to_session_v1('e1800000-0000-4000-8000-000000000002',r.table_id,r.table_session_id,r.attendance_id,now()+interval '45 minutes','scale40-'||r.n);
  PERFORM pg_temp.assert_true(result->>'outcome'='ok','40-table worker exact session commit');
 END LOOP;
END $scale$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=40 AND count(DISTINCT a.attendance_id)=40 AND count(DISTINCT a.table_session_id)=40
 FROM public.dealer_assignments a JOIN scale40 x ON x.table_id=a.table_id WHERE a.released_at IS NULL),'40 canonical assignments conserved without duplicates');
-- Planning an already-due replacement must honor the execution floor (15 min),
-- not reserve a dealer at minute 14 and leave execution waiting on its own plan.
INSERT INTO public.dealers(id,club_id,full_name,status)
VALUES('e1800000-0000-4000-8000-000000000033','e1800000-0000-4000-8000-000000000002','Rest-boundary TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,last_released_at)
VALUES('e1800000-0000-4000-8000-000000000043','e1800000-0000-4000-8000-000000000033',
 'e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now()-interval '60 minutes','available',now()-interval '14 minutes');
INSERT INTO public.dealer_rotation_schedule(id,club_id,table_id,assignment_id,slot_index,planned_relief_at,plan_run_id,solver_version)
SELECT 'e1800000-0000-4000-8000-000000000070',club_id,table_id,id,0,now()-interval '1 minute',
 'e1800000-0000-4000-8000-000000000071','rest-boundary-test'
FROM public.dealer_assignments WHERE table_id='e1800000-0000-4000-8000-000000000013' AND released_at IS NULL;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
DO $rest_boundary$
DECLARE result jsonb;
BEGIN
 result := public.set_rotation_slot_dealer('e1800000-0000-4000-8000-000000000070',1,
  'e1800000-0000-4000-8000-000000000043','isolated_rest_boundary');
 RAISE NOTICE 'REST14_RPC_OUTCOME=%', result;
 PERFORM pg_temp.assert_true(result->>'outcome'='not_eligible',
  '14-minute rest must not lock an already-due replacement; actual='||result::text);
END $rest_boundary$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT current_state='available' FROM public.dealer_attendance
 WHERE id='e1800000-0000-4000-8000-000000000043'),'rejected rest boundary preserves attendance');
INSERT INTO auth.users(id) VALUES('e1800000-0000-4000-8000-000000000099');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT pg_temp.assert_true(public.set_rotation_slot_dealer('e1800000-0000-4000-8000-000000000070',1,
 'e1800000-0000-4000-8000-000000000043','isolated_cross_club')->>'outcome'='forbidden',
 'outsider cannot reserve next dealer');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT version=1 AND in_attendance_id IS NULL FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070'),'denied actor leaves plan unchanged');
UPDATE public.dealer_attendance SET last_released_at=now()-interval '15 minutes'
WHERE id='e1800000-0000-4000-8000-000000000043';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT pg_temp.assert_true(public.set_rotation_slot_dealer('e1800000-0000-4000-8000-000000000070',1,
 'e1800000-0000-4000-8000-000000000043','isolated_rest_boundary')->>'outcome'='changed',
 '15-minute fully-rested dealer can be planned without shifting due time');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT planned_relief_at=now()-interval '1 minute' FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070'),'planning does not move established relief time');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT pg_temp.assert_true(public.set_rotation_slot_dealer('e1800000-0000-4000-8000-000000000070',1,
 'e1800000-0000-4000-8000-000000000043','isolated_stale_plan')->>'outcome'='race_lost',
 'old plan version cannot reserve again');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT version=2 FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070'),'stale retry does not bump plan version twice');
-- Canonical close with an announced replacement must not strand that incoming
-- Normal forecast slots have no assignment yet and never lock a dealer. They
-- must be cancelled on close, not misclassified as malformed slot0 links.
INSERT INTO public.dealer_rotation_schedule(id,club_id,table_id,assignment_id,slot_index,planned_relief_at,plan_run_id,solver_version)
VALUES('e1800000-0000-4000-8000-000000000072','e1800000-0000-4000-8000-000000000002',
 'e1800000-0000-4000-8000-000000000013',NULL,1,now()+interval '45 minutes',
 'e1800000-0000-4000-8000-000000000071','forecast-close TEST');
-- attendance or carry the previous incarnation's plan into a reopen.
-- Browser cannot SELECT table_sessions directly. Supply its already-loaded
-- expected revision from fixture setup, without granting any new privilege.
SELECT set_config('test.close_expected_revision',revision::text,true)
FROM public.table_sessions WHERE id='e1800000-0000-4000-8000-000000000023';
CREATE FUNCTION pg_temp.expect_close_scope_rejected(expected_error text DEFAULT 'closed_session_rotation_scope_invalid') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',
    current_setting('test.close_expected_revision')::bigint,'e1800000-0000-4000-8000-000000000080');
  RAISE EXCEPTION 'malformed_plan_close_was_not_rejected';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>expected_error THEN RAISE; END IF;
 END;
END $$;
SAVEPOINT malformed_null_link;
UPDATE public.dealer_rotation_schedule SET assignment_id=NULL WHERE id='e1800000-0000-4000-8000-000000000070';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_close_scope_rejected();
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id='e1800000-0000-4000-8000-000000000023'),
 'null-linked schedule rejection preserves open session');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000043'),
 'null-linked schedule rejection preserves incoming marker');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='e1800000-0000-4000-8000-000000000080'),
 'rejected malformed close writes no receipt');
ROLLBACK TO SAVEPOINT malformed_null_link;
SAVEPOINT malformed_other_session;
UPDATE public.dealer_rotation_schedule SET assignment_id=(SELECT id FROM public.dealer_assignments
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL)
 WHERE id='e1800000-0000-4000-8000-000000000070';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_close_scope_rejected();
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id='e1800000-0000-4000-8000-000000000023'),
 'other-session linked schedule rejection preserves open session');
ROLLBACK TO SAVEPOINT malformed_other_session;
SAVEPOINT conflicting_announced_claim;
UPDATE public.dealer_assignments SET pre_assigned_attendance_id='e1800000-0000-4000-8000-000000000043'
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_close_scope_rejected('closed_session_announced_reservation_conflict');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id='e1800000-0000-4000-8000-000000000023'),
 'conflicting announced claim preserves open session');
SELECT pg_temp.assert_true((SELECT status='announced' AND version=2 FROM public.dealer_rotation_schedule WHERE id='e1800000-0000-4000-8000-000000000070'),
 'conflicting announced claim preserves plan');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' AND pre_assigned_table_id='e1800000-0000-4000-8000-000000000013'
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000043'),
 'conflicting claim cannot release incoming attendance');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='e1800000-0000-4000-8000-000000000080'),
 'conflicting announced claim creates no close receipt');
ROLLBACK TO SAVEPOINT conflicting_announced_claim;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT pg_temp.assert_true(public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',
 current_setting('test.close_expected_revision')::bigint,'e1800000-0000-4000-8000-000000000079')->>'error'='actor_not_allowed',
 'outsider cannot close session or release another clubs reservation');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status='announced' AND version=2 FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070'),'forbidden close preserves announced plan');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
RESET ROLE;
CREATE FUNCTION pg_temp.reject_close_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.operation_type='operator_close_club_table_v2'
  AND NEW.request_id='e1800000-0000-4000-8000-000000000080' THEN
  RAISE EXCEPTION 'injected_close_receipt_failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_reject_close_receipt BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_close_receipt();
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_close_scope_rejected('injected_close_receipt_failure');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions
 WHERE id='e1800000-0000-4000-8000-000000000023'),'receipt-save failure rolls session close back');
SELECT pg_temp.assert_true((SELECT status='announced' AND version=2 FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070'),'receipt-save failure restores cancelled plan');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' AND pre_assigned_table_id='e1800000-0000-4000-8000-000000000013'
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000043'),
 'receipt-save failure restores incoming reservation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='e1800000-0000-4000-8000-000000000080'),
 'receipt-save failure leaves no false receipt');
DROP TRIGGER test_reject_close_receipt ON public.table_operation_receipts;
SET LOCAL ROLE authenticated;
DO $close_rollback$
DECLARE result jsonb;
BEGIN
 BEGIN
  result:=public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',
    current_setting('test.close_expected_revision')::bigint,'e1800000-0000-4000-8000-000000000080');
  PERFORM pg_temp.assert_true((result->>'ok')::boolean,'close rollback probe reaches successful RPC');
  RAISE EXCEPTION 'injected_close_transaction_rollback';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'injected_close_transaction_rollback' THEN RAISE; END IF;
 END;
END $close_rollback$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions
 WHERE id='e1800000-0000-4000-8000-000000000023'),'failed transaction preserves open session');
SELECT pg_temp.assert_true((SELECT status='announced' AND version=2 FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070'),'failed transaction restores announced plan');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' AND pre_assigned_table_id='e1800000-0000-4000-8000-000000000013'
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000043'),
 'failed transaction restores incoming reservation');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
DO $close_with_next$
DECLARE result jsonb; session_revision bigint;
BEGIN
 session_revision:=current_setting('test.close_expected_revision')::bigint;
 result:=public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',session_revision,
   'e1800000-0000-4000-8000-000000000080');
 RAISE NOTICE 'CLOSE_WITH_NEXT_RPC_OUTCOME=%',result;
 PERFORM pg_temp.assert_true((result->>'ok')::boolean,'canonical close succeeds with announced replacement');
 PERFORM pg_temp.assert_true(public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',
   session_revision,'e1800000-0000-4000-8000-000000000080')=result,'close replay returns exact original receipt');
 PERFORM pg_temp.assert_true(public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',
   session_revision+1,'e1800000-0000-4000-8000-000000000080')->>'error'='IDEMPOTENCY_CONFLICT',
   'same close key with changed revision conflicts');
END $close_with_next$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions
 WHERE id='e1800000-0000-4000-8000-000000000023'),'exact old session closed');
SELECT pg_temp.assert_true((SELECT current_state='available' AND pre_assigned_table_id IS NULL
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000043'),
 'canonical close releases incoming next-dealer reservation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule
 WHERE id='e1800000-0000-4000-8000-000000000070' AND status IN ('predicted','announced','executing')),
 'closed incarnation cannot retain actionable rotation plan');
-- Legacy reservation without a schedule, created with the real acquisition
-- triggers enabled. Closing must still release it after Auto is switched OFF.
SET LOCAL request.jwt.claim.role='service_role';
SELECT set_config('request.headers','{}',true);
UPDATE public.dealer_assignments SET pre_assigned_attendance_id='e1800000-0000-4000-8000-000000000043',
 pre_assigned_at=now() WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL;
UPDATE public.dealer_attendance SET current_state='pre_assigned',
 pre_assigned_table_id='e1800000-0000-4000-8000-000000000011',pre_assigned_at=now()
 WHERE id='e1800000-0000-4000-8000-000000000043';
UPDATE public.club_settings SET auto_swing_enabled=false
 WHERE club_id='e1800000-0000-4000-8000-000000000002';
SELECT set_config('test.legacy_session',id::text,true),set_config('test.legacy_revision',revision::text,true)
 FROM public.table_sessions WHERE game_table_id='e1800000-0000-4000-8000-000000000011' AND closed_at IS NULL;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT pg_temp.assert_true((public.operator_close_club_table_v2(current_setting('test.legacy_session')::uuid,
 current_setting('test.legacy_revision')::bigint,'e1800000-0000-4000-8000-000000000081')->>'ok')::boolean,
 'canonical close releases legacy reservation even with Auto OFF');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT current_state='available' AND pre_assigned_table_id IS NULL
 AND last_released_at=now()-interval '15 minutes' AND check_out_time IS NULL
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000043'),
 'legacy close frees marker without changing rest or checkout evidence');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_assignments
 WHERE table_session_id=current_setting('test.legacy_session')::uuid
 AND (released_at IS NULL OR pre_assigned_attendance_id IS NOT NULL)),
 'closed legacy session has no live assignment or incoming reservation');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT public.operator_open_dealer_tables('e1800000-0000-4000-8000-000000000082',
 'e1800000-0000-4000-8000-000000000002',null,ARRAY['e1800000-0000-4000-8000-000000000013'::uuid],'cash');
SELECT pg_temp.assert_true(public.operator_close_club_table_v2('e1800000-0000-4000-8000-000000000023',
 current_setting('test.close_expected_revision')::bigint,'e1800000-0000-4000-8000-000000000083')->>'error'='table_session_not_active',
 'late close request for old incarnation cannot close reopened table');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.table_sessions
 WHERE game_table_id='e1800000-0000-4000-8000-000000000013' AND closed_at IS NULL
 AND id<>'e1800000-0000-4000-8000-000000000023'),'reopen creates distinct active incarnation');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_assignments
 WHERE table_id='e1800000-0000-4000-8000-000000000013' AND released_at IS NULL),
 'reopen does not resurrect old dealer assignment');
ROLLBACK;
