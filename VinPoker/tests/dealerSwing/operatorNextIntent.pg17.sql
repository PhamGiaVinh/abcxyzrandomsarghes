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
 PERFORM pg_temp.assert_true(public.operator_plan_next_dealer_v1(c.table_session_id,c.id,c.version+1,
 'e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000090')->>'outcome'='idempotency_conflict','changed payload conflicts');
END $next80$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.dealer_rotation_schedule
 WHERE table_id='e1800000-0000-4000-8000-000000000011' AND slot_index=0 AND status='announced'),'one committed next plan');
SELECT pg_temp.assert_true((SELECT current_state='pre_assigned' AND pre_assigned_table_id='e1800000-0000-4000-8000-000000000011'
 FROM public.dealer_attendance WHERE id='e1800000-0000-4000-8000-000000000044'),'incoming marker exactly bound');
ROLLBACK;
