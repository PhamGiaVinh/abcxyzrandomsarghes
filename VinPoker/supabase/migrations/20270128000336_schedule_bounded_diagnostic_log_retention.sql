-- Owner-gated activation. Preserve existing job identity, replace its daily
-- unbounded command with a bounded sweep every5min. No other job is changed.
-- On canary error: disable only this exact job; preserve source/checkpoint.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $migration$
DECLARE v_job bigint;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'diagnostic_scheduler_wrong_actor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cleanup_old_diagnostic_logs()')
   AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig=ARRAY['search_path=""']
   AND md5(replace(prosrc,chr(13),''))='8f25037ad2e2aad06b51083806239522')
   OR has_function_privilege('anon','public.cleanup_old_diagnostic_logs()','EXECUTE')
   OR has_function_privilege('authenticated','public.cleanup_old_diagnostic_logs()','EXECUTE')
   OR has_function_privilege('service_role','public.cleanup_old_diagnostic_logs()','EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM retention_private.diagnostic_checkpoint WHERE singleton) THEN
   RAISE EXCEPTION 'diagnostic_scheduler_source_drift'; END IF;
 IF (SELECT count(*) FROM cron.job WHERE jobname='cleanup-diagnostic-logs')<>1
   OR (SELECT count(*) FROM cron.job WHERE command LIKE '%cleanup_old_diagnostic_logs%')<>1 THEN
   RAISE EXCEPTION 'diagnostic_scheduler_identity_ambiguous'; END IF;
 SELECT jobid INTO STRICT v_job FROM cron.job WHERE jobname='cleanup-diagnostic-logs'
   AND username='postgres' AND database=current_database() AND active
   AND schedule='0 3 * * *' AND command='SELECT cleanup_old_diagnostic_logs()';
 PERFORM cron.alter_job(job_id:=v_job,schedule:='4-59/5 * * * *',
   command:=$command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_old_diagnostic_logs();$command$);
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=v_job AND jobname='cleanup-diagnostic-logs'
   AND active AND username='postgres' AND database=current_database() AND schedule='4-59/5 * * * *'
   AND command=$command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_old_diagnostic_logs();$command$) THEN
   RAISE EXCEPTION 'diagnostic_scheduler_postcheck_failed'; END IF;
END $migration$;
COMMIT;
