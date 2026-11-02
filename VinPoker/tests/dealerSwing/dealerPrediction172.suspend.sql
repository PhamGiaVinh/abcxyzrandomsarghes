-- Reviewed emergency suspension candidate ONLY. Not executed automatically.
-- Never restore the anonymous unscoped predecessor. Retain data/history.
BEGIN;
SET LOCAL lock_timeout='3s';
REVOKE ALL ON FUNCTION public.get_table_assignments_with_next(uuid),public.predict_next_dealers(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
