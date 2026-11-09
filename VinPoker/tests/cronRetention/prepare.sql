-- Disposable database only. Do not run against a hosted project.
-- CI uses real pg_cron; local preliminary runs may bootstrap the same typed
-- table fixture separately. Never create or alter a hosted extension here.
DO $$BEGIN
 IF to_regclass('cron.job_run_details') IS NULL OR to_regclass('cron.job') IS NULL THEN
   RAISE EXCEPTION 'disposable cron schema must be bootstrapped first'; END IF;
END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cron_history_owner') THEN
   CREATE ROLE cron_history_owner NOLOGIN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END$$;
ALTER TABLE cron.job_run_details OWNER TO cron_history_owner;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT SELECT,UPDATE,DELETE ON cron.job_run_details TO postgres;
GRANT SELECT ON cron.job TO postgres;
-- Existing hosted scheduling capability; never grant this in production SQL.
GRANT EXECUTE ON FUNCTION cron.schedule_in_database(text,text,text,text,text,boolean),
 cron.schedule(text,text,text),cron.unschedule(bigint) TO postgres;
GRANT CREATE ON SCHEMA public TO postgres;
GRANT CREATE ON DATABASE :DBNAME TO postgres;
