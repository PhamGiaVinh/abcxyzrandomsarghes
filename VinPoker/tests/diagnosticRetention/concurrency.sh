#!/usr/bin/env bash
# Disposable database only. Do not pass a production connection.
set -euo pipefail
gate="$(mktemp -d)"
holder=''
worker=''
cleanup() {
  touch "$gate/release"
  if [[ -n "$holder" ]]; then wait "$holder" || true; fi
  if [[ -n "$worker" ]]; then wait "$worker" || true; fi
  rm -rf "$gate"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.diagnostic_logs(id,created_at)
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()-interval '8 days'
 FROM generate_series(1,10)n;
SQL
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.diagnostic_logs FOR UPDATE;
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout='3s';
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM retention_private.diagnostic_checkpoint WHERE last_inspected=10 AND last_deleted=0 AND completed_sweeps=1) THEN
   RAISE EXCEPTION 'locked row scan unbounded or blocking'; END IF;
END$$;
SQL
touch "$gate/release"; wait "$holder"; holder=''
psql -X -v ON_ERROR_STOP=1 <<'SQL'
-- A committed eligibility correction survives: retain the now-recent row.
UPDATE public.diagnostic_logs SET created_at=now() WHERE id='00000000-0000-0000-0000-000000000001';
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF (SELECT count(*) FROM public.diagnostic_logs)<>1
   OR NOT EXISTS(SELECT 1 FROM retention_private.diagnostic_checkpoint WHERE total_deleted=9 AND completed_sweeps=2) THEN
   RAISE EXCEPTION 'skipped rows not revisited or eligibility correction lost'; END IF;
END$$;
SQL
rm -f "$gate/ready" "$gate/release"
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(70335,1);
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF (SELECT completed_sweeps FROM retention_private.diagnostic_checkpoint)<>2 THEN
   RAISE EXCEPTION 'busy worker advanced checkpoint'; END IF;
END$$;
DELETE FROM public.diagnostic_logs;
SQL
touch "$gate/release"; wait "$holder"; holder=''
rm -f "$gate/ready" "$gate/release"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
UPDATE retention_private.diagnostic_checkpoint SET scan_after=NULL,sweep_ceiling=NULL,completed_sweeps=0,total_deleted=0,total_inspected=0;
INSERT INTO public.diagnostic_logs(created_at) SELECT now()-interval '8 days' FROM generate_series(1,20);
CREATE FUNCTION public.diagnostic_worker_gate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(70335,2);RETURN OLD;END$$;
CREATE TRIGGER diagnostic_worker_gate BEFORE DELETE ON public.diagnostic_logs FOR EACH ROW EXECUTE FUNCTION public.diagnostic_worker_gate();
SQL
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(70335,2);
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 -c "SET statement_timeout='10s'; SELECT public.cleanup_old_diagnostic_logs();" >"$gate/worker.log" 2>&1 &
worker=$!
locked='0'
for i in {1..100}; do
  locked="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=70335 AND objid=1 AND granted;")"
  [[ "$locked" = 1 ]] && break
  sleep 0.05
done
test "$locked" = 1
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF (SELECT total_inspected FROM retention_private.diagnostic_checkpoint)<>0 THEN
   RAISE EXCEPTION 'second actual worker advanced first worker checkpoint'; END IF;
END$$;
SQL
touch "$gate/release"; wait "$holder"; holder=''; wait "$worker"; worker=''
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DROP TRIGGER diagnostic_worker_gate ON public.diagnostic_logs;
DROP FUNCTION public.diagnostic_worker_gate();
SELECT public.cleanup_old_diagnostic_logs();
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.diagnostic_logs)
 OR (SELECT total_deleted FROM retention_private.diagnostic_checkpoint)<>20 THEN
   RAISE EXCEPTION 'two worker retry lost or double-counted source'; END IF;
END$$;
SQL
echo DIAGNOSTIC_RETENTION_CONCURRENCY_PASS
