\set ON_ERROR_STOP on
-- Append inside the candidate's transaction before single671's final rollback.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT has_function_privilege('authenticated','floor_private.cancel_rotation_slot_internal274(uuid,text,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','floor_private.cancel_rotation_slot_internal274(uuid,text,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','floor_private.clear_session_dealer_reservations274(uuid)','EXECUTE');
END $$;
SAVEPOINT denied_actor;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.cancel_rotation_slot('4ef20172-1278-4395-90a4-d46325c08426','manual');
 ASSERT r->>'outcome'='error' AND r->>'sqlstate'='42501',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426' AND status='announced');
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='pre_assigned');
END $$;
ROLLBACK TO denied_actor;

SAVEPOINT executing;
-- Seed this transient branch with the authorized manual actor; do not enable
-- Auto or disable the acquisition trigger just to manufacture executing state.
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
UPDATE public.dealer_rotation_schedule SET status='executing' WHERE id='4ef20172-1278-4395-90a4-d46325c08426';
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.floor_break_table_v5(p_tournament_table_id=>'4f493b5e-ef25-4e55-bafd-faab24fcade9',p_expected_revision=>2,
   p_draw_mode=>'fill_lowest_table',p_request_id=>'381733df-5402-4e27-bb62-536f01abc672',p_plan_hash=>'ddb1a1e6102e50beaa327e9b07cdd1a4');
  RAISE EXCEPTION '672_EXPECTED_EXECUTING_DENIAL';
 EXCEPTION WHEN raise_exception THEN
  ASSERT SQLERRM='closed_session_rotation_executing',SQLERRM;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND closed_at IS NULL AND revision=2);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_seats WHERE id='84885ae4-208c-4831-aec2-6015caa0fb53' AND is_active AND table_id='4f493b5e-ef25-4e55-bafd-faab24fcade9');
END $$;
ROLLBACK TO executing;

SAVEPOINT wrong_session;
UPDATE public.dealer_rotation_schedule SET assignment_id='dfebfb3c-d6bc-437b-a400-0d0b6a9f086a' WHERE id='4ef20172-1278-4395-90a4-d46325c08426';
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.floor_break_table_v5(p_tournament_table_id=>'4f493b5e-ef25-4e55-bafd-faab24fcade9',p_expected_revision=>2,
   p_draw_mode=>'fill_lowest_table',p_request_id=>'381733df-5402-4e27-bb62-536f01abc673',p_plan_hash=>'ddb1a1e6102e50beaa327e9b07cdd1a4');
  RAISE EXCEPTION '672_EXPECTED_SCOPE_DENIAL';
 EXCEPTION WHEN raise_exception THEN
  ASSERT SQLERRM='closed_session_rotation_scope_invalid',SQLERRM;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND closed_at IS NULL AND revision=2);
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='pre_assigned');
END $$;
ROLLBACK TO wrong_session;

SAVEPOINT legacy_reservation;
UPDATE public.dealer_rotation_schedule SET status='cancelled' WHERE id='4ef20172-1278-4395-90a4-d46325c08426';
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_break_table_v5(p_tournament_table_id=>'4f493b5e-ef25-4e55-bafd-faab24fcade9',p_expected_revision=>2,
  p_draw_mode=>'fill_lowest_table',p_request_id=>'381733df-5402-4e27-bb62-536f01abc674',p_plan_hash=>'ddb1a1e6102e50beaa327e9b07cdd1a4');
 ASSERT r->>'ok'='true' AND r->>'closed'='true',r::text;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='1f3f1e56-db9d-46b9-9e3b-531845da5802' AND current_state='available' AND pre_assigned_at IS NULL AND pre_assigned_table_id IS NULL);
END $$;
ROLLBACK TO legacy_reservation;
SELECT 'CLOSE672_PRIVATE_ACL_PUBLIC_DENIAL_EXECUTING_OLDSESSION_LEGACY_RESERVATION_PASS';
