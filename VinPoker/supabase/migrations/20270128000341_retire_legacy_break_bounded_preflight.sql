-- Replacement for NEVER_APPLIED 340: bounded current-backend observation,
-- never a scan of managed cron history. Retire only the observed failing job.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $retire$
DECLARE
 before_job cron.job%ROWTYPE;
 after_job cron.job%ROWTYPE;
BEGIN
 IF current_user <> 'postgres' THEN
   RAISE EXCEPTION 'legacy_break_retirement_wrong_actor';
 END IF;
 SELECT * INTO STRICT before_job FROM cron.job WHERE jobid=22;
 IF before_job.jobname IS DISTINCT FROM 'enforce-break-balance'
 OR before_job.schedule IS DISTINCT FROM '*/5 * * * *'
 OR before_job.username IS DISTINCT FROM 'postgres'
 OR before_job.database IS DISTINCT FROM 'postgres'
 OR before_job.nodename IS DISTINCT FROM 'localhost'
 OR before_job.nodeport IS DISTINCT FROM 5432
 OR before_job.active IS DISTINCT FROM true
 OR md5(before_job.command) IS DISTINCT FROM 'e55b52aa6ceb03f6f276bfd19e1f3769' THEN
   RAISE EXCEPTION 'legacy_break_retirement_catalog_drift';
 END IF;
 IF current_setting('app.settings.service_role_key',true) IS NOT NULL THEN
   RAISE EXCEPTION 'legacy_break_retirement_credential_state_changed';
 END IF;
 -- Conservative: reject ANY same-actor/database cron worker/client, including
 -- idle/NULL/starting states. Only launcher and this preflight are excluded.
 -- Observation is bounded by current backends, not historical run cardinality.
 -- This is not an atomic drain: a worker may start after the observation.
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a
   WHERE a.pid<>pg_catalog.pg_backend_pid()
   AND a.datname=before_job.database AND a.usename=before_job.username
   AND a.backend_type IS DISTINCT FROM 'pg_cron launcher'
   AND (a.backend_type='pg_cron' OR a.application_name LIKE 'pg_cron%')) THEN
   RAISE EXCEPTION 'legacy_break_retirement_job_busy';
 END IF;
 PERFORM cron.alter_job(22,active:=false);
 SELECT * INTO STRICT after_job FROM cron.job WHERE jobid=22;
 IF after_job.active IS DISTINCT FROM false
 OR (to_jsonb(after_job)-'active') IS DISTINCT FROM (to_jsonb(before_job)-'active') THEN
   RAISE EXCEPTION 'legacy_break_retirement_unexpected_change';
 END IF;
END $retire$;
COMMIT;
