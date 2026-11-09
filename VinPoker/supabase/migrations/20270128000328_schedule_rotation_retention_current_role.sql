-- Replacement for unapplied 327: pg_cron requires superuser whenever username
-- is supplied, including one's own role. Keep the same postgres-owned job by
-- requiring that execution role and using pg_cron's current-role default.
-- Rollback: unschedule only retention-rotation-schedule; preserve source/audit.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'rotation_retention_scheduler_requires_postgres';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule') THEN
    RAISE EXCEPTION 'rotation_retention_job_already_exists';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cleanup_dealer_rotation_schedule(uuid,integer)')
    AND md5(replace(prosrc,chr(13),''))='bb691193de6f47b57014a6c44194db21')
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cleanup_next_dealer_rotation_schedule(integer)')
    AND md5(replace(prosrc,chr(13),''))='7719cb70ae682b03f92e12f6773aa193') THEN
    RAISE EXCEPTION 'rotation_retention_bounded_functions_drift';
  END IF;
END $guard$;
SELECT cron.schedule_in_database(
  'retention-rotation-schedule','3-59/5 * * * *',
  $command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_next_dealer_rotation_schedule(5000);$command$,
  current_database(),NULL,true
);
DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname='retention-rotation-schedule') <> 1
    OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule'
      AND username='postgres' AND database=current_database() AND active
      AND schedule='3-59/5 * * * *'
      AND command=$command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_next_dealer_rotation_schedule(5000);$command$) THEN
    RAISE EXCEPTION 'rotation_retention_scheduler_postcheck_failed';
  END IF;
END $postcheck$;
COMMIT;
