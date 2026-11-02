-- Run in qualification transaction after migration212, before release177.
-- All seeded blockers below are rolled back; not an acceptance of their writers.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT closed_at IS NULL AND revision=10 FROM public.table_sessions
  WHERE id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55');
END $$;
SAVEPOINT release178_off;
GRANT USAGE ON SCHEMA auth TO authenticated;
UPDATE public.multi_day_package_release_v1 SET enabled=false WHERE id;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17800000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'package_off_was_ignored';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='multi_day_package_release_off',SQLERRM; END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT release178_off;
SAVEPOINT release178_mode;
GRANT USAGE ON SCHEMA auth TO authenticated;
UPDATE public.multi_day_package_release_v1 SET enabled=true,
 allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
INSERT INTO floor_private.table_mode_requests_v1(id,table_session_id,tournament_table_id,actor_id,target_mode,initial_epoch,status,blockers)
VALUES('17800000-0000-4000-8000-000000000002','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',
 '8ce69933-b2d0-4dfe-962e-86709c6222ac','675fe35e-60a8-4452-bb90-e79486d54da6','manual',2,'pending','[]');
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.release_bagged_flight_table_v1('8ce69933-b2d0-4dfe-962e-86709c6222ac','c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',10,'9b83697a48dba8fac105ffbf058147a1',1,'17800000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'pending_mode_was_ignored';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='bagged_release_pending_operation',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='8ce69933-b2d0-4dfe-962e-86709c6222ac' AND is_active)=8;
 ASSERT (SELECT closed_at IS NULL AND revision=10 FROM public.table_sessions WHERE id='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55');
 ASSERT NOT EXISTS(SELECT 1 FROM floor_private.bagged_flight_release_permits_v1);
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='17800000-0000-4000-8000-000000000003');
END $$;
ROLLBACK TO SAVEPOINT release178_mode;
SELECT 'RELEASE178_PACKAGE_OFF_PENDING_MODE_NO_SIDE_EFFECT_PASS';
