#!/usr/bin/env bash
# Disposable database only. SQL setup/cleanup is confined to the test database.
set -euo pipefail
gate="$(mktemp -d)"
holder=''
cleanup() {
  touch "$gate/release"
  if [[ -n "$holder" ]]; then wait "$holder" || true; fi
  rm -rf "$gate"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO cron.job_run_details(runid,status,start_time,end_time)
 SELECT n,'failed',now()-interval '8 days',now()-interval '8 days' FROM generate_series(1,10) n;
SQL
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT runid FROM cron.job_run_details WHERE runid<=10 FOR UPDATE;
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout='3s';
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_cron_job_run_details(10);
 IF (r->>'deleted')::int<>0 OR (r->>'inspected')::int<>10 THEN
   RAISE EXCEPTION 'locked page not bounded %',r; END IF;
END$$;
SQL
touch "$gate/release"
wait "$holder"
holder=''
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_cron_job_run_details(10);
 IF (r->>'deleted')::int<>10 OR EXISTS(SELECT 1 FROM cron.job_run_details) THEN
   RAISE EXCEPTION 'locked rows not revisited %',r; END IF;
END$$;
SQL
rm -f "$gate/ready" "$gate/release"
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(70331,1);
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$BEGIN
 IF public.cleanup_cron_job_run_details(1)->>'outcome'<>'busy' THEN
   RAISE EXCEPTION 'concurrent worker not fenced'; END IF;
END$$;
SQL
echo CRON_RETENTION_CONCURRENCY_PASS

