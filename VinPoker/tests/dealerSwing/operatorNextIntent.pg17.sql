-- Appended to the existing synthetic mass-open seed, before canonical close.
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
 ('e1800000-0000-4000-8000-000000000034','e1800000-0000-4000-8000-000000000002','Operator next TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state,last_released_at)
VALUES('e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000034',
 'e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now()-interval '60 minutes','available',now()-interval '14 minutes');
UPDATE public.dealer_assignments SET swing_due_at=now()-interval '1 minute'
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL;
CREATE TEMP TABLE next80_context AS SELECT id,table_session_id,version FROM public.dealer_assignments
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL;
GRANT SELECT ON next80_context TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000099';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT pg_temp.assert_true((SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')->>'outcome'='forbidden'
 FROM next80_context),'outsider cannot plan next dealer');
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')->>'outcome'='not_eligible'
 FROM next80_context),'14min dealer cannot be reserved for already due relief');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0),'rejected delegate rolls newly created slot back');
UPDATE public.dealer_attendance SET last_released_at=now()-interval '15 minutes'
 WHERE id='e1800000-0000-4000-8000-000000000044';
CREATE FUNCTION pg_temp.reject_next80_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.operation_type='operator_plan_next_dealer_v1'
  AND NEW.request_id='e1800000-0000-4000-8000-000000000089' THEN
  RAISE EXCEPTION 'injected_next80_receipt_failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_reject_next80_receipt BEFORE INSERT ON public.table_operation_receipts
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_next80_receipt();
CREATE TEMP TABLE next80_before_receipt_failure AS SELECT
 (SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE a.id=(SELECT id FROM next80_context)) AS assignment,
 (SELECT to_jsonb(d) FROM public.dealer_attendance d
  WHERE d.id='e1800000-0000-4000-8000-000000000044') AS attendance;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.operator_plan_next_dealer_v1(table_session_id,id,version,
   'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000089') FROM next80_context;
  RAISE EXCEPTION 'receipt failure was not propagated';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'injected_next80_receipt_failure' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT
 assignment IS NOT DISTINCT FROM (SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE a.id=(SELECT id FROM next80_context))
 AND attendance IS NOT DISTINCT FROM (SELECT to_jsonb(d) FROM public.dealer_attendance d
  WHERE d.id='e1800000-0000-4000-8000-000000000044') FROM next80_before_receipt_failure),
 'receipt failure restores complete assignment and incoming attendance');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0),
 'receipt failure rolls new schedule back');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts
 WHERE request_id='e1800000-0000-4000-8000-000000000089'),'receipt failure leaves no receipt');
DROP TRIGGER test_reject_next80_receipt ON public.table_operation_receipts;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
DO $next80$ DECLARE c record; result jsonb; BEGIN
 SELECT * INTO c FROM next80_context;
 result:=public.operator_plan_next_dealer_v1(c.table_session_id,c.id,c.version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090');
 RAISE NOTICE 'NEXT80_RPC_OUTCOME=%',result;
 PERFORM pg_temp.assert_true(result->>'outcome'='changed','15min no-slot intent commits');
 PERFORM pg_temp.assert_true(public.operator_plan_next_dealer_v1(c.table_session_id,c.id,c.version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')=result,'same key returns exact receipt');
 PERFORM pg_temp.assert_true(public.get_dealer_next_intent_receipt_v1(c.table_session_id,c.id,c.version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')=result,'read-only receipt returns exact committed result');
 PERFORM pg_temp.assert_true(public.get_dealer_next_intent_receipt_v1(c.table_session_id,c.id,c.version+1,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')->>'outcome'='idempotency_conflict','receipt rejects altered payload');
 PERFORM pg_temp.assert_true(public.get_dealer_next_intent_receipt_v1(c.table_session_id,c.id,c.version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000088')->>'outcome'='not_recorded','missing receipt is not success');
 PERFORM pg_temp.assert_true(public.operator_plan_next_dealer_v1(c.table_session_id,c.id,c.version+1,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')->>'outcome'='idempotency_conflict','changed payload conflicts');
END $next80$;
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000099';
SELECT pg_temp.assert_true((SELECT public.get_dealer_next_intent_receipt_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')->>'outcome'='forbidden'
 FROM next80_context),'outsider cannot read operator receipt');
SET LOCAL request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_rotation_schedule
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0 AND status='announced'),'one committed next plan');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' AND pre_assigned_table_id='e1800000-0000-4000-8000-000000000011'
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000044'),'incoming marker exactly bound');
-- A predicted candidate is advisory, not an existing reservation. Choosing
-- that same candidate must still CHOT it, not acknowledge a no-op without lock.
UPDATE public.dealer_rotation_schedule SET status='predicted',version=version+1
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0;
UPDATE public.dealer_assignments SET pre_assigned_attendance_id=NULL,pre_assigned_at=NULL,planned_relief_at=NULL
 WHERE id=(SELECT id FROM next80_context);
UPDATE public.dealer_attendance SET current_state='available',pre_assigned_table_id=NULL,pre_assigned_at=NULL
 WHERE id='e1800000-0000-4000-8000-000000000044';
UPDATE next80_context c SET version=a.version FROM public.dealer_assignments a WHERE a.id=c.id;
SET LOCAL ROLE authenticated;
SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000091') FROM next80_context;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_rotation_schedule
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0 AND status='announced'),
 'choosing same predicted candidate must create real announced lock');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' AND pre_assigned_table_id='e1800000-0000-4000-8000-000000000011'
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000044'),
 'same predicted candidate becomes operationally reserved');
SELECT pg_temp.assert_true((SELECT planned_relief_at=now()-interval '1 minute'
 AND reason->'operator_confirmed_prediction'->>'attendance_id'='e1800000-0000-4000-8000-000000000044'
 FROM public.dealer_rotation_schedule WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0),
 'prediction confirmation preserves due time and audited previous advisory choice');
-- An announced schedule with no operational reservation is inconsistent; it
-- Before replacing an old announced reservation, reject cross-club ownership
-- and another active assignment claiming that old incoming attendance.
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('e1800000-0000-4000-8000-000000000003',
 'e1800000-0000-4000-8000-000000000099','Other operator TEST','TEST');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('e1800000-0000-4000-8000-000000000035',
 'e1800000-0000-4000-8000-000000000002','Replacement TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
VALUES('e1800000-0000-4000-8000-000000000045','e1800000-0000-4000-8000-000000000035',
 'e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
UPDATE next80_context c SET version=a.version FROM public.dealer_assignments a WHERE a.id=c.id;
SAVEPOINT old_reservation_cross_club;
UPDATE public.dealers SET club_id='e1800000-0000-4000-8000-000000000003'
 WHERE id='e1800000-0000-4000-8000-000000000034';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000045','e1800000-0000-4000-8000-000000000093')->>'outcome'='plan_requires_repair'
 FROM next80_context),'cross-club old reservation cannot be released by replacement');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' FROM public.dealer_attendance
 WHERE id='e1800000-0000-4000-8000-000000000044'),'cross-club old marker untouched');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts
 WHERE request_id='e1800000-0000-4000-8000-000000000093'),'cross-club replacement writes no receipt');
ROLLBACK TO SAVEPOINT old_reservation_cross_club;
SAVEPOINT old_reservation_competing_claim;
UPDATE public.dealer_assignments SET pre_assigned_attendance_id='e1800000-0000-4000-8000-000000000044'
 WHERE table_id='e1800000-0000-4000-8000-000000000013' AND released_at IS NULL;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000045','e1800000-0000-4000-8000-000000000094')->>'outcome'='plan_requires_repair'
 FROM next80_context),'competing claim on old incoming blocks replacement');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' FROM public.dealer_attendance
 WHERE id='e1800000-0000-4000-8000-000000000044'),'competing claim cannot free old incoming');
SELECT pg_temp.assert_true((SELECT current_state='available' FROM public.dealer_attendance
 WHERE id='e1800000-0000-4000-8000-000000000045'),'rejected replacement leaves new incoming available');
ROLLBACK TO SAVEPOINT old_reservation_competing_claim;
SAVEPOINT old_reservation_is_serving;
UPDATE public.dealer_rotation_schedule SET in_attendance_id='e1800000-0000-4000-8000-000000000041'
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0 AND status='announced';
UPDATE public.dealer_assignments SET pre_assigned_attendance_id=attendance_id
 WHERE id=(SELECT id FROM next80_context);
UPDATE public.dealer_attendance SET current_state='pre_assigned',
 pre_assigned_table_id='e1800000-0000-4000-8000-000000000011',pre_assigned_at=now()
 WHERE id='e1800000-0000-4000-8000-000000000041';
UPDATE next80_context c SET version=a.version FROM public.dealer_assignments a WHERE a.id=c.id;
CREATE TEMP TABLE self_link_before AS SELECT
 (SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE a.id=(SELECT id FROM next80_context)) AS assignment,
 (SELECT to_jsonb(s) FROM public.dealer_rotation_schedule s
  WHERE s.table_id='e1800000-0000-4000-8000-000000000011' AND s.slot_index=0 AND s.status='announced') AS schedule,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.dealer_attendance d
  WHERE d.id IN('e1800000-0000-4000-8000-000000000041','e1800000-0000-4000-8000-000000000045')) AS attendance;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000045','e1800000-0000-4000-8000-000000000095')->>'outcome'='plan_requires_repair'
 FROM next80_context),'self-linked announced reservation cannot free currently serving dealer');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT
 assignment IS NOT DISTINCT FROM (SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE a.id=(SELECT id FROM next80_context))
 AND schedule IS NOT DISTINCT FROM (SELECT to_jsonb(s) FROM public.dealer_rotation_schedule s
  WHERE s.table_id='e1800000-0000-4000-8000-000000000011' AND s.slot_index=0 AND s.status='announced')
 AND attendance IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.dealer_attendance d
  WHERE d.id IN('e1800000-0000-4000-8000-000000000041','e1800000-0000-4000-8000-000000000045'))
 FROM self_link_before),'rejected self-link preserves full assignment schedule and attendance rows');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' FROM public.dealer_attendance
 WHERE id='e1800000-0000-4000-8000-000000000041'),'serving attendance marker untouched after rejected self-link');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts
 WHERE request_id='e1800000-0000-4000-8000-000000000095'),'self-link writes no receipt');
ROLLBACK TO SAVEPOINT old_reservation_is_serving;
-- The missing assignment/attendance half of an announced triad is not a noop.
-- must not receive a successful same-dealer no-op receipt.
UPDATE public.dealer_assignments SET pre_assigned_attendance_id=NULL,pre_assigned_at=NULL,planned_relief_at=NULL
 WHERE id=(SELECT id FROM next80_context);
UPDATE public.dealer_attendance SET current_state='available',pre_assigned_table_id=NULL,pre_assigned_at=NULL
 WHERE id='e1800000-0000-4000-8000-000000000044';
UPDATE next80_context c SET version=a.version FROM public.dealer_assignments a WHERE a.id=c.id;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT public.operator_plan_next_dealer_v1(table_session_id,id,version,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000092')->>'outcome'='plan_requires_repair'
 FROM next80_context),'inconsistent announced same-dealer no-op must not acknowledge a nonexistent reservation');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.table_operation_receipts
 WHERE request_id='e1800000-0000-4000-8000-000000000092'),'inconsistent reservation writes no success receipt');
ROLLBACK;
