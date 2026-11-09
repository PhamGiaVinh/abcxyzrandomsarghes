#!/usr/bin/env bash
# Actual committed eligibility changes after the candidate cursor was opened.
set -euo pipefail
work="$(mktemp -d)"
cleanup() {
  touch "$work/release"
  wait || true
  psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DROP TRIGGER IF EXISTS cron_history_race_gate ON cron.job_run_details;
DROP FUNCTION IF EXISTS public.cron_history_race_gate();
DELETE FROM cron.job_run_details WHERE runid BETWEEN 1 AND 5;
SQL
  rm -rf -- "$work"
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO cron.job_run_details(runid,status,start_time,end_time)
SELECT n,'succeeded',now()-interval '8 days',now()-interval '8 days' FROM generate_series(1,5)n;
CREATE FUNCTION public.cron_history_race_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(70331,2); RETURN OLD; END$$;
CREATE TRIGGER cron_history_race_gate BEFORE DELETE ON cron.job_run_details
 FOR EACH ROW WHEN(OLD.runid=1) EXECUTE FUNCTION public.cron_history_race_gate();
SQL
{
cat <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(70331,2);
\echo GATE_READY
SQL
for i in {1..600}; do [[ -e "$work/release" ]] && break; sleep 0.05; done
echo 'COMMIT;'
} | psql -X -v ON_ERROR_STOP=1 >"$work/gate.log" &
holder=$!
for i in {1..100}; do grep -q GATE_READY "$work/gate.log" && break; sleep 0.02; done
grep -q GATE_READY "$work/gate.log"
PGAPPNAME=cron-history-race-cleanup psql -X -qAt -v ON_ERROR_STOP=1 \
 -c 'SELECT public.cleanup_cron_job_run_details(5);' >"$work/result" &
cleaner=$!
ready=0
for i in {1..100}; do
  ready="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='cron-history-race-cleanup' AND wait_event_type='Lock' AND wait_event='advisory';")"
  [[ "$ready" = 1 ]] && break
  sleep 0.01
done
test "$ready" = 1
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE cron.job_run_details SET status='running' WHERE runid=2;
UPDATE cron.job_run_details SET start_time=now() WHERE runid=3;
UPDATE cron.job_run_details SET end_time=NULL WHERE runid=4;
COMMIT;
SQL
touch "$work/release"
wait "$holder"
wait "$cleaner"
grep -q '"inspected": 5' "$work/result"
grep -q '"deleted": 2' "$work/result"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c 'SELECT count(*)=3 AND bool_and(runid IN(2,3,4)) FROM cron.job_run_details;')" = t
echo CRON_RETENTION_CURSOR_UPDATE_RACE_PASS
