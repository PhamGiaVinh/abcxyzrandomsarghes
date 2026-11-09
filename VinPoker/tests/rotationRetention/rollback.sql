-- Exercise source-only recovery in the disposable database. No row restoration.
\set ON_ERROR_STOP on
DO $test$
DECLARE predecessor record;
BEGIN
  SELECT * INTO STRICT predecessor FROM public.rotation_budget_test_predecessor;
  EXECUTE predecessor.definition;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.cleanup_dealer_rotation_schedule(uuid,integer)'::regprocedure
    AND md5(replace(prosrc,chr(13),''))=predecessor.source_md5
    AND proowner=predecessor.proowner AND proacl IS NOT DISTINCT FROM predecessor.proacl
    AND proconfig IS NOT DISTINCT FROM predecessor.proconfig) THEN
    RAISE EXCEPTION 'rotation budget source recovery differs'; END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='retention-rotation-schedule') THEN
    RAISE EXCEPTION 'recovery unexpectedly scheduled cleanup'; END IF;
END $test$;
DROP TABLE public.rotation_budget_test_predecessor;
