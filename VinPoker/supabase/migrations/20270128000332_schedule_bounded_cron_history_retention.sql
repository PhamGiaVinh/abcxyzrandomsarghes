-- Owner-gated activation. Inspect <=5000 PRIMARY KEY rows every5min, not5000
-- guaranteed deletes. Read-only canary:3 completed ticks; unschedule on error.
-- Rollback: unschedule only retention-cron-history, preserve source/checkpoint.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'cron_history_scheduler_wrong_actor'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-cron-history'
      OR command LIKE '%cleanup_cron_job_run_details%') THEN
   RAISE EXCEPTION 'cron_history_scheduler_already_exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc
      WHERE oid=to_regprocedure('public.cleanup_cron_job_run_details(integer)')
      AND md5(replace(prosrc,chr(13),''))='da8c72fa3893a816d0aaf3346bbdfda4'
      AND proowner='postgres'::regrole AND prosecdef
      AND proconfig=ARRAY['search_path=""'])
    OR has_function_privilege('anon','public.cleanup_cron_job_run_details(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_cron_job_run_details(integer)','EXECUTE')
    OR NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user)
    OR NOT EXISTS(SELECT 1 FROM retention_private.cron_history_checkpoint WHERE singleton) THEN
   RAISE EXCEPTION 'cron_history_scheduler_source_or_scope_drift'; END IF;
END $guard$;
SELECT cron.schedule_in_database(
 'retention-cron-history','1-59/5 * * * *',
 $command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_cron_job_run_details(5000);$command$,
 current_database(),NULL,true);
DO $postcheck$
BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname='retention-cron-history')<>1
    OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-cron-history'
      AND active AND username='postgres' AND database=current_database()
      AND schedule='1-59/5 * * * *'
      AND command=$command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_cron_job_run_details(5000);$command$) THEN
   RAISE EXCEPTION 'cron_history_scheduler_postcheck_failed'; END IF;
END $postcheck$;
COMMIT;
