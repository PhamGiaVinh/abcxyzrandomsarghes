\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION public.cron_retention_slow_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_sleep(0.03); RETURN OLD; END$$;
CREATE TRIGGER slow_delete BEFORE DELETE ON cron.job_run_details
 FOR EACH ROW EXECUTE FUNCTION public.cron_retention_slow_fixture();
INSERT INTO cron.job_run_details(runid,status,start_time,end_time)
SELECT n,'failed',now()-interval '8 days',now()-interval '8 days' FROM generate_series(1,400) n;
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_cron_job_run_details(400);
 IF (r->>'deleted')::int<1 OR (r->>'deleted')::int>=400
    OR (r->>'elapsed_ms')::numeric<1900 OR (r->>'elapsed_ms')::numeric>5000 THEN
   RAISE EXCEPTION 'cooperative budget not effective %',r; END IF;
 RAISE NOTICE 'CRON_RETENTION_SLOW_WORK %',r;
END$$;
ROLLBACK;
\echo CRON_RETENTION_BUDGET_PASS

