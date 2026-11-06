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
CREATE SEQUENCE ops_reentry_transport_probe_v1.notification_timeout_attempts;
CREATE TABLE ops_reentry_transport_probe_v1.timeout_mode(singleton boolean PRIMARY KEY CHECK(singleton),enabled boolean NOT NULL);
ALTER TABLE ops_reentry_transport_probe_v1.timeout_mode ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops_reentry_transport_probe_v1.timeout_mode FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO ops_reentry_transport_probe_v1.timeout_mode VALUES(true,false);
CREATE FUNCTION ops_reentry_transport_probe_v1.bank_probe_source_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'registrations',(SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'')) FROM public.tournament_registrations r),
  'entries',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id)::text,'')) FROM public.tournament_entries e),
  'movements',(SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id)::text,'')) FROM public.cashier_buyin_movements m)
 );
$$;
REVOKE ALL ON FUNCTION ops_reentry_transport_probe_v1.bank_probe_source_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE ops_reentry_transport_probe_v1.bank_probe_before(singleton boolean PRIMARY KEY CHECK(singleton),snapshot jsonb NOT NULL);
ALTER TABLE ops_reentry_transport_probe_v1.bank_probe_before ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops_reentry_transport_probe_v1.bank_probe_before FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ops_reentry_transport_probe_v1.fail_optional_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.type='registration_confirmed' AND NEW.data->>'reentry'='true'
  AND NEW.data->>'tournament_id'='a3000000-0000-4000-8000-000000000001' THEN
  IF (SELECT enabled FROM ops_reentry_transport_probe_v1.timeout_mode WHERE singleton) THEN
   PERFORM nextval('ops_reentry_transport_probe_v1.notification_timeout_attempts');
   PERFORM pg_sleep(5);
   RAISE EXCEPTION 'ISOLATED_NOTIFICATION_TIMEOUT_DID_NOT_FIRE';
  END IF;
  PERFORM nextval('ops_reentry_transport_probe_v1.notification_attempts');
  RAISE EXCEPTION 'ISOLATED_OPTIONAL_REENTRY_NOTIFICATION_FAULT';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ops_reentry_transport_probe_v1.fail_optional_notification() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_reentry_transport_notification_fault AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION ops_reentry_transport_probe_v1.fail_optional_notification();
COMMIT;
