-- Rotation history only. No other retention job is activated by this release.
-- At most one club/status and 5,000 rows per five-minute tick.
-- Rollback: unschedule only retention-rotation-schedule; keep source/audit data.
BEGIN;
DO $guard$
BEGIN
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
  current_database(),'postgres',true
);
COMMIT;
