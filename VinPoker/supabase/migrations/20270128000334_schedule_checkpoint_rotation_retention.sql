-- Owner-gated activation. Inspect <=5000 PRIMARY KEY rows every5min, not5000
-- guaranteed deletes. Read-only canary:3 completed ticks; unschedule on error.
-- Rollback: unschedule only retention-rotation-schedule, preserve source/checkpoint.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'rotation_checkpoint_scheduler_wrong_actor'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule'
      OR command LIKE '%cleanup_next_dealer_rotation_schedule%') THEN
   RAISE EXCEPTION 'rotation_checkpoint_scheduler_already_exists'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc
      WHERE oid=to_regprocedure('public.cleanup_next_dealer_rotation_schedule(integer)')
      AND md5(replace(prosrc,chr(13),''))='8bca99b269d106a371d83bf3684985bf'
      AND proowner='postgres'::regrole AND prosecdef
      AND proconfig=ARRAY['search_path=""'])
    OR has_function_privilege('anon','public.cleanup_next_dealer_rotation_schedule(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_next_dealer_rotation_schedule(integer)','EXECUTE')
    OR NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user)
    OR NOT EXISTS(SELECT 1 FROM retention_private.rotation_checkpoint WHERE singleton) THEN
   RAISE EXCEPTION 'rotation_checkpoint_scheduler_source_or_scope_drift'; END IF;
END $guard$;
SELECT cron.schedule_in_database(
 'retention-rotation-schedule','3-59/5 * * * *',
 $command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_next_dealer_rotation_schedule(5000);$command$,
 current_database(),NULL,true);
DO $postcheck$
BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname='retention-rotation-schedule')<>1
    OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule'
      AND active AND username='postgres' AND database=current_database()
      AND schedule='3-59/5 * * * *'
      AND command=$command$SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_next_dealer_rotation_schedule(5000);$command$) THEN
   RAISE EXCEPTION 'rotation_checkpoint_scheduler_postcheck_failed'; END IF;
END $postcheck$;
COMMIT;
