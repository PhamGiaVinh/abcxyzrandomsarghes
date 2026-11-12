-- Retire only the observed failing legacy scheduler. Do not repair its
-- credential: that would activate legacy forced breaks and notifications.
-- Preserve its command, schedule, history and all other jobs.
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
 -- Stop if the known failure condition has changed: this package must not
 -- disable a repaired/working scheduler or interrupt a running invocation.
 IF current_setting('app.settings.service_role_key',true) IS NOT NULL THEN
   RAISE EXCEPTION 'legacy_break_retirement_credential_state_changed';
 END IF;
 IF EXISTS (SELECT 1 FROM cron.job_run_details
   WHERE jobid=22 AND status IN ('starting','running')) THEN
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
