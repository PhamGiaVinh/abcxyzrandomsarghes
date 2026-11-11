#!/usr/bin/env bash
set -euo pipefail
# Real statement cancellation in its own connection; not a mocked SQL error.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.diagnostic_logs(created_at) SELECT now()-interval '8 days' FROM generate_series(1,20);
CREATE FUNCTION public.diagnostic_timeout_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.03);RETURN OLD;END$$;
CREATE TRIGGER diagnostic_timeout_test BEFORE DELETE ON public.diagnostic_logs FOR EACH ROW EXECUTE FUNCTION public.diagnostic_timeout_test();
SQL
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
if psql -X -v ON_ERROR_STOP=1 -c "SET statement_timeout='100ms'; SELECT public.cleanup_old_diagnostic_logs();" >"$log" 2>&1; then
  echo DIAGNOSTIC_TIMEOUT_DID_NOT_CANCEL >&2; exit 1
fi
grep -q 'statement timeout' "$log"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$BEGIN
 IF (SELECT count(*) FROM public.diagnostic_logs)<>20
 OR (SELECT total_inspected FROM retention_private.diagnostic_checkpoint)<>0 THEN
   RAISE EXCEPTION 'statement cancellation changed committed source/checkpoint'; END IF;
END$$;
DROP TRIGGER diagnostic_timeout_test ON public.diagnostic_logs;
DROP FUNCTION public.diagnostic_timeout_test();
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.diagnostic_logs)
 OR NOT EXISTS(SELECT 1 FROM retention_private.diagnostic_checkpoint WHERE total_deleted=20 AND completed_sweeps=1) THEN
   RAISE EXCEPTION 'retry after cancellation failed'; END IF;
END$$;
UPDATE retention_private.diagnostic_checkpoint SET scan_after=NULL,sweep_ceiling=NULL,completed_sweeps=0,total_deleted=0,total_inspected=0;
SQL
echo DIAGNOSTIC_RETENTION_TIMEOUT_RETRY_PASS
