-- Appended to the existing rollback-only canonical operational fixture.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e1700000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"sub":"e1700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),'positive exact-session prediction');
RESET ROLE;
UPDATE public.dealer_assignments SET dealer_id='e1700000-0000-4000-8000-000000000039' WHERE table_session_id='e1700000-0000-4000-8000-000000000021';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),'quarantined denormalized dealer identity cannot predict');
RESET ROLE;
UPDATE public.dealer_assignments SET dealer_id='e1700000-0000-4000-8000-000000000031' WHERE table_session_id='e1700000-0000-4000-8000-000000000021';
UPDATE public.dealer_assignments SET table_session_id=NULL WHERE table_session_id='e1700000-0000-4000-8000-000000000021';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002'))
 AND (SELECT count(*)=0 FROM public.predict_next_dealers('e1700000-0000-4000-8000-000000000002')),'sessionless legacy assignment cannot predict the active incarnation');
RESET ROLE;
DO $test$ BEGIN
 BEGIN
  UPDATE public.dealer_assignments SET table_session_id='e1700000-0000-4000-8000-000000000024' WHERE table_id='e1700000-0000-4000-8000-000000000011';
  RAISE EXCEPTION 'closed_session_fixture_was_not_rejected';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'floor_table_v3_dealer_assignment_session_not_active' THEN RAISE;END IF;
 END;
END $test$;
UPDATE public.dealer_assignments SET table_session_id='e1700000-0000-4000-8000-000000000021',pre_assigned_attendance_id='e1700000-0000-4000-8000-000000000049'
 WHERE table_id='e1700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(next_dealer IS NULL) FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),'cross-club preassignment is not a confirmed next dealer');
RESET ROLE;
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('e1700000-0000-4000-8000-000000000032','e1700000-0000-4000-8000-000000000002','Next projection TEST','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
 VALUES('e1700000-0000-4000-8000-000000000042','e1700000-0000-4000-8000-000000000032','e1700000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
UPDATE public.dealer_assignments SET pre_assigned_attendance_id='e1700000-0000-4000-8000-000000000042' WHERE table_id='e1700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(next_dealer='Next projection TEST') FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),'compatible checked-in preassignment remains visible');
RESET ROLE;
UPDATE public.dealer_attendance SET status='checked_out',check_out_time=now(),current_state='checked_out' WHERE id='e1700000-0000-4000-8000-000000000042';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(next_dealer IS NULL) FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),'checked-out preassignment not confirmed');
RESET ROLE;
UPDATE public.dealer_assignments SET released_at=now() WHERE table_id='e1700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.get_table_assignments_with_next('e1700000-0000-4000-8000-000000000002')),'released assignment excluded even if status marker remains assigned');
RESET ROLE;
SELECT 'PREDICTION_EXACT_SESSION_QUARANTINE_AND_NEXT_ATTENDANCE_ROLLBACK_PASS';
