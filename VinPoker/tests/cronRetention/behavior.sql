\set ON_ERROR_STOP on
BEGIN;
INSERT INTO cron.job_run_details(runid,status,start_time,end_time) VALUES
 (1,'succeeded',now()-interval '8 days',now()-interval '8 days'),
 (2,'failed',now()-interval '9 days',now()-interval '8 days'),
 (3,'running',now()-interval '9 days',NULL),
 (4,'connecting',now()-interval '9 days',now()-interval '8 days'),
 (5,'succeeded',now()-interval '1 day',now()),
 (6,'succeeded',NULL,now()),
 (7,'succeeded',now()-interval '9 days',NULL),
 (8,NULL,now()-interval '9 days',now()),
 (9,'unknown',now()-interval '9 days',now()),
 (10,'failed',now()-interval '9 days',now());
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_cron_job_run_details(2);
 IF (r->>'inspected')::int<>2 OR (r->>'deleted')::int<>2
    OR NOT EXISTS(SELECT 1 FROM retention_private.cron_history_checkpoint
       WHERE scan_after=2 AND last_inspected=2 AND last_deleted=2
         AND total_inspected=2 AND total_deleted=2 AND last_started_at IS NOT NULL) THEN
   RAISE EXCEPTION 'first bounded page mismatch %',r; END IF;
 -- A completion before the next page is eligible on that page.
 UPDATE cron.job_run_details SET status='succeeded',end_time=now() WHERE runid=3;
 r:=public.cleanup_cron_job_run_details(3);
 IF (r->>'inspected')::int<>3 OR (r->>'deleted')::int<>1 THEN
   RAISE EXCEPTION 'second page mismatch %',r; END IF;
 INSERT INTO cron.job_run_details(runid,status,start_time,end_time)
 VALUES(11,'failed',now()-interval '9 days',now());
 r:=public.cleanup_cron_job_run_details(5000);
 IF NOT (r->>'sweep_complete')::boolean OR EXISTS(SELECT 1 FROM cron.job_run_details WHERE runid=10)
    OR NOT EXISTS(SELECT 1 FROM cron.job_run_details WHERE runid=11) THEN
   RAISE EXCEPTION 'fixed ceiling mismatch %',r; END IF;
 -- This row was already inspected without a completion; revisit next sweep.
 UPDATE cron.job_run_details SET end_time=now() WHERE runid=7;
 r:=public.cleanup_cron_job_run_details(NULL);
 IF (r->>'deleted')::int<>2 OR EXISTS(SELECT 1 FROM cron.job_run_details WHERE runid IN(7,11))
    OR (SELECT count(*) FROM cron.job_run_details)<>5 THEN
   RAISE EXCEPTION 'restart sweep mismatch %',r; END IF;
 IF has_schema_privilege('service_role','retention_private','USAGE')
    OR has_function_privilege('anon','public.cleanup_cron_job_run_details(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.cleanup_cron_job_run_details(integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.cleanup_cron_job_run_details(integer)','EXECUTE') THEN
   RAISE EXCEPTION 'ACL mismatch'; END IF;
END$$;
-- Statement abort rolls back checkpoint and deletion together.
SAVEPOINT before_abort;
SELECT public.cleanup_cron_job_run_details(1);
ROLLBACK TO before_abort;
ROLLBACK;
BEGIN;
INSERT INTO cron.job_run_details(runid,status,start_time,end_time)
VALUES(1,'failed',now()-interval '8 days',now());
CREATE FUNCTION public.cron_retention_fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic worker failure'; END$$;
CREATE TRIGGER failed_worker BEFORE DELETE ON cron.job_run_details
 FOR EACH ROW EXECUTE FUNCTION public.cron_retention_fail_fixture();
DO $$BEGIN
 BEGIN
   PERFORM public.cleanup_cron_job_run_details(1);
   RAISE EXCEPTION 'expected failure absent';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'synthetic worker failure' THEN RAISE; END IF;
 END;
 IF (SELECT scan_after FROM retention_private.cron_history_checkpoint)<>0
    OR (SELECT total_deleted FROM retention_private.cron_history_checkpoint)<>0
    OR NOT EXISTS(SELECT 1 FROM cron.job_run_details WHERE runid=1) THEN
   RAISE EXCEPTION 'failed worker advanced checkpoint or source'; END IF;
END$$;
DROP TRIGGER failed_worker ON cron.job_run_details;
DO $$BEGIN
 IF (public.cleanup_cron_job_run_details(1)->>'deleted')::int<>1 THEN
   RAISE EXCEPTION 'retry after worker failure lost work'; END IF;
END$$;
ROLLBACK;
\echo CRON_RETENTION_BEHAVIOR_PASS
