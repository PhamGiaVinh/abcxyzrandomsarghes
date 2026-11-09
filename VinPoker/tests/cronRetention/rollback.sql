-- Isolated rehearsal of a forward rollback: preserve the cron source table.
BEGIN;
DO $$DECLARE old record; BEGIN
 SELECT * INTO STRICT old FROM public.cron_retention_predecessor;
 EXECUTE old.definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc
   WHERE oid='public.cleanup_cron_job_run_details(integer)'::regprocedure
     AND md5(replace(prosrc,chr(13),''))=old.source_md5
     AND proacl IS NOT DISTINCT FROM old.proacl
     AND proconfig IS NOT DISTINCT FROM old.proconfig
     AND proowner=old.proowner AND prosecdef=old.prosecdef) THEN
   RAISE EXCEPTION 'rollback source/owner/ACL/config mismatch'; END IF;
END$$;
DROP TABLE retention_private.cron_history_checkpoint;
DROP SCHEMA retention_private;
ROLLBACK;
\echo CRON_RETENTION_RECOVERY_PASS

