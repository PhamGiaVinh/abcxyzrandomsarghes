\set ON_ERROR_STOP on
BEGIN;
INSERT INTO cron.job_run_details(runid,status,start_time,end_time,command,return_message)
SELECT n,CASE WHEN n%2=0 THEN 'succeeded' ELSE 'running' END,
 now()-interval '8 days',CASE WHEN n%2=0 THEN now()-interval '8 days' END,
 repeat('synthetic',30),repeat('test',30)
FROM generate_series(1,1000000) n;
ANALYZE cron.job_run_details;
-- Capture actual nested page/TID deletion plans against the million-row table.
-- Only two rows under auto_explain to avoid logging thousands of row deletes.
LOAD 'auto_explain';
SET LOCAL auto_explain.log_min_duration=0;
SET LOCAL auto_explain.log_analyze=on;
SET LOCAL auto_explain.log_nested_statements=on;
SET LOCAL auto_explain.log_format=json;
SET LOCAL auto_explain.log_level=notice;
SELECT public.cleanup_cron_job_run_details(2);
SET LOCAL auto_explain.log_min_duration=-1;
DO $$DECLARE r jsonb; BEGIN
 FOR i IN 1..2 LOOP
   PERFORM set_config('plan_cache_mode',CASE WHEN i=1 THEN 'force_custom_plan' ELSE 'force_generic_plan' END,true);
   r:=public.cleanup_cron_job_run_details(5000);
   IF (r->>'inspected')::int>5000 OR (r->>'inspected')::int<1
      OR (r->>'deleted')::int>(r->>'inspected')::int
      OR EXISTS(SELECT 1 FROM cron.job_run_details WHERE runid=1)=false THEN
     RAISE EXCEPTION 'million row bound/integrity mismatch %',r; END IF;
   RAISE NOTICE 'CRON_RETENTION_MILLION_ROW % %',current_setting('plan_cache_mode'),r;
 END LOOP;
END$$;
ROLLBACK;
\echo CRON_RETENTION_SCALE_PASS
