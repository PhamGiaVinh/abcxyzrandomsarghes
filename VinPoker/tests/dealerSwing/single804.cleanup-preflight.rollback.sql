\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT status='completed' FROM public.tournaments WHERE id='c367013a-3ed3-48af-ad48-3915acadc50e');
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments WHERE attendance_id IN('47323bd1-60a3-42a8-99c6-ede1c33f5f90','e03c9a69-7c3d-4431-aa98-a801015dfae5','1f3f1e56-db9d-46b9-9e3b-531845da5802','6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a') AND released_at IS NULL);
END $$;
SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT public.administrative_close_stale_dealer_attendance(
 ARRAY['47323bd1-60a3-42a8-99c6-ede1c33f5f90','e03c9a69-7c3d-4431-aa98-a801015dfae5','1f3f1e56-db9d-46b9-9e3b-531845da5802','6b2ea4bd-67d4-47ef-94e2-5cfe7e5a6c4a']::uuid[],
 'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
RESET ROLE;
ROLLBACK;
