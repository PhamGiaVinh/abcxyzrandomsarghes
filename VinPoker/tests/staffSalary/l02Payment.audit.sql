-- Owned isolated fixture only. Record effective transitions, not repeated reads.
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_l02'; END $$;
CREATE SCHEMA l02_payment_fixture;
REVOKE ALL ON SCHEMA l02_payment_fixture FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE l02_payment_fixture.effective_payments(run_id uuid, paid_at timestamptz, paid_by uuid, amount bigint);
CREATE FUNCTION l02_payment_fixture.audit_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO l02_payment_fixture.effective_payments VALUES(NEW.id,NEW.paid_at,NEW.paid_by,NEW.net_vnd);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION l02_payment_fixture.audit_payment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER l02_effective_payment AFTER UPDATE ON public.staff_salary_runs
FOR EACH ROW WHEN(NEW.id='16680000-0000-4000-8000-000000000031'::uuid
  AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status='paid')
EXECUTE FUNCTION l02_payment_fixture.audit_payment();
