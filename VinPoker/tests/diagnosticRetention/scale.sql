\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.diagnostic_logs(id,created_at,timestamp,result)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n%2=0 THEN now()-interval '8 days' ELSE now() END,
 CASE WHEN n%2=0 THEN now() ELSE now()-interval '100 days' END,
 jsonb_build_object('synthetic',repeat('x',200)) FROM generate_series(1,1000000)n;
ANALYZE public.diagnostic_logs;
EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM public.diagnostic_logs
 WHERE id<='00000000-0000-0000-0000-999999999999' ORDER BY id LIMIT 5000;
DO $$DECLARE c record;v_calls integer:=0;v_start timestamptz:=clock_timestamp();BEGIN
 FOR i IN 1..500 LOOP
   PERFORM public.cleanup_old_diagnostic_logs();v_calls:=v_calls+1;
   SELECT * INTO STRICT c FROM retention_private.diagnostic_checkpoint;
   IF c.last_inspected NOT BETWEEN 0 AND 5000 OR c.last_deleted>c.last_inspected THEN
     RAISE EXCEPTION 'unbounded page %',row_to_json(c); END IF;
   EXIT WHEN c.completed_sweeps=1;
 END LOOP;
 IF c.completed_sweeps<>1 OR c.total_inspected<>1000000 OR c.total_deleted<>500000
   OR (SELECT count(*) FROM public.diagnostic_logs)<>500000
   OR EXISTS(SELECT 1 FROM public.diagnostic_logs WHERE created_at<now()-interval '7 days') THEN
   RAISE EXCEPTION 'million-row full sweep mismatch %',row_to_json(c); END IF;
 RAISE NOTICE 'DIAGNOSTIC_MILLION_FULL_SWEEP calls=% elapsed_ms=% inspected=% deleted=%',
   v_calls,extract(epoch FROM(clock_timestamp()-v_start))*1000,c.total_inspected,c.total_deleted;
END$$;
ROLLBACK;
BEGIN;
INSERT INTO public.diagnostic_logs(created_at) SELECT now()-interval '8 days' FROM generate_series(1,300);
CREATE FUNCTION public.diagnostic_test_slow() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.03);RETURN OLD;END$$;
CREATE TRIGGER diagnostic_test_slow BEFORE DELETE ON public.diagnostic_logs FOR EACH ROW EXECUTE FUNCTION public.diagnostic_test_slow();
SELECT public.cleanup_old_diagnostic_logs();
DO $$DECLARE c record;BEGIN
 SELECT * INTO STRICT c FROM retention_private.diagnostic_checkpoint;
 IF c.last_inspected NOT BETWEEN 1 AND 100 OR c.last_work_ms NOT BETWEEN 1900 AND 5000 THEN
   RAISE EXCEPTION 'cooperative budget ineffective %',row_to_json(c); END IF;
END$$;
ROLLBACK;
\echo DIAGNOSTIC_RETENTION_SCALE_BUDGET_PASS
