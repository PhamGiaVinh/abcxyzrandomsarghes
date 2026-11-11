\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.diagnostic_logs(id,created_at,timestamp,club_id)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 CASE n WHEN 1 THEN now()-interval '8 days' WHEN 2 THEN now() WHEN 3 THEN NULL
 WHEN 4 THEN now()-interval '7 days' WHEN 5 THEN now()-interval '9 days' END,
 CASE WHEN n=2 THEN now()-interval '100 days' ELSE now() END,
 CASE WHEN n=5 THEN NULL ELSE '00000000-0000-0000-0000-000000000001'::uuid END
FROM generate_series(1,5)n;
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF (SELECT count(*) FROM public.diagnostic_logs)<>3
   OR NOT EXISTS(SELECT 1 FROM public.diagnostic_logs WHERE id='00000000-0000-0000-0000-000000000002')
   OR NOT EXISTS(SELECT 1 FROM retention_private.diagnostic_checkpoint
      WHERE total_inspected=5 AND total_deleted=2 AND completed_sweeps=1) THEN
   RAISE EXCEPTION 'created_at/null/exact-boundary/cross-club retention mismatch'; END IF;
END$$;
-- Idempotent retry: retained rows remain and no deletion is counted twice.
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF (SELECT total_deleted FROM retention_private.diagnostic_checkpoint)<>2 THEN
   RAISE EXCEPTION 'retry counted deletion twice'; END IF;
END$$;
ROLLBACK;
-- UUID zero inserted behind an already committed-shape cursor is revisited.
-- Deleting the captured ceiling must still allow the current sweep to finish.
BEGIN;
INSERT INTO public.diagnostic_logs(id,created_at)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()-interval '8 days'
FROM generate_series(1,6001)n;
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF (SELECT scan_after FROM retention_private.diagnostic_checkpoint) IS NULL THEN
   RAISE EXCEPTION 'first batch did not leave a checkpoint'; END IF;
END$$;
INSERT INTO public.diagnostic_logs(id,created_at) VALUES('00000000-0000-0000-0000-000000000000',now()-interval '8 days');
DELETE FROM public.diagnostic_logs WHERE id=(SELECT sweep_ceiling FROM retention_private.diagnostic_checkpoint);
DO $$BEGIN
 FOR i IN 1..20 LOOP
   PERFORM public.cleanup_old_diagnostic_logs();
   EXIT WHEN (SELECT completed_sweeps FROM retention_private.diagnostic_checkpoint)=1;
 END LOOP;
 IF (SELECT completed_sweeps FROM retention_private.diagnostic_checkpoint)<>1
 OR NOT EXISTS(SELECT 1 FROM public.diagnostic_logs WHERE id='00000000-0000-0000-0000-000000000000') THEN
   RAISE EXCEPTION 'deleted ceiling/behind-cursor insert mishandled'; END IF;
 PERFORM public.cleanup_old_diagnostic_logs();
 IF EXISTS(SELECT 1 FROM public.diagnostic_logs) THEN RAISE EXCEPTION 'behind-cursor UUID zero lost'; END IF;
END$$;
ROLLBACK;
-- A deletion failure must roll back both the source rows and checkpoint.
BEGIN;
INSERT INTO public.diagnostic_logs(created_at) VALUES(now()-interval '8 days');
CREATE FUNCTION public.diagnostic_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_failure'; END$$;
CREATE TRIGGER diagnostic_test_fail BEFORE DELETE ON public.diagnostic_logs FOR EACH ROW EXECUTE FUNCTION public.diagnostic_test_fail();
DO $$BEGIN
 BEGIN
   PERFORM public.cleanup_old_diagnostic_logs();
   RAISE EXCEPTION 'missing failure';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'fixture_failure' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.diagnostic_logs)<>1
   OR (SELECT total_inspected FROM retention_private.diagnostic_checkpoint)<>0 THEN
   RAISE EXCEPTION 'failed transaction advanced checkpoint or deleted source'; END IF;
END$$;
ROLLBACK;
DO $$BEGIN
 IF has_function_privilege('anon','public.cleanup_old_diagnostic_logs()','EXECUTE')
 OR has_function_privilege('authenticated','public.cleanup_old_diagnostic_logs()','EXECUTE')
 OR has_function_privilege('service_role','public.cleanup_old_diagnostic_logs()','EXECUTE')
 OR has_schema_privilege('anon','retention_private','USAGE') THEN
   RAISE EXCEPTION 'scheduler/private checkpoint exposed'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.cleanup_old_diagnostic_logs()'::regprocedure) THEN
   RAISE EXCEPTION 'invoker unexpectedly elevated'; END IF;
END$$;
SET ROLE anon;
DO $$BEGIN
 BEGIN
   PERFORM public.cleanup_old_diagnostic_logs();
   RAISE EXCEPTION 'anonymous call succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
\echo DIAGNOSTIC_RETENTION_BEHAVIOR_PASS
