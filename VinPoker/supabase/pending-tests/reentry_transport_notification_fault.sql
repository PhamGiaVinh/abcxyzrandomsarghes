-- Disposable candidate runtime only; never part of a production migration.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres'
  OR current_setting('vinpoker.isolated_reentry_transport',true) IS DISTINCT FROM 'current-composite-v1'
  OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='a2000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST')
  OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='a3000000-0000-4000-8000-000000000001' AND name='Cashier Edge TEST Tour')
  OR to_regprocedure('public.cashier_app_reentry_transport_v1(uuid,uuid)') IS NULL
  OR to_regnamespace('ops_reentry_transport_probe_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'isolated_reentry_fault_required';
 END IF;
END $$;
CREATE SCHEMA ops_reentry_transport_probe_v1;
REVOKE ALL ON SCHEMA ops_reentry_transport_probe_v1 FROM PUBLIC,anon,authenticated,service_role;
-- A nontransactional sequence is diagnostic only: it records an actual trigger
-- attempt even when its inserted notification and subtransaction are rolled back.
CREATE SEQUENCE ops_reentry_transport_probe_v1.notification_attempts;
CREATE FUNCTION ops_reentry_transport_probe_v1.fail_optional_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.type='registration_confirmed' AND NEW.data->>'reentry'='true'
  AND NEW.data->>'tournament_id'='a3000000-0000-4000-8000-000000000001' THEN
  PERFORM nextval('ops_reentry_transport_probe_v1.notification_attempts');
  RAISE EXCEPTION 'ISOLATED_OPTIONAL_REENTRY_NOTIFICATION_FAULT';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops_reentry_transport_probe_v1.fail_optional_notification() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_reentry_transport_notification_fault AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION ops_reentry_transport_probe_v1.fail_optional_notification();
COMMIT;
