#!/usr/bin/env bash
# Real pg_cron on disposable service only. No network dispatch in this fixture.
set -euo pipefail
migration=VinPoker/supabase/migrations/20270128000336_schedule_bounded_diagnostic_log_retention.sql
log="$(mktemp)"
probe=''
cleanup() {
  if [[ -n "$probe" ]]; then PGUSER=postgres psql -X -qAt -c "SELECT cron.unschedule($probe);"; fi
  rm -f "$log"
}
trap cleanup EXIT
original="$(PGUSER=postgres psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT cron.schedule('cleanup-diagnostic-logs','0 3 * * *','SELECT cleanup_old_diagnostic_logs()');")"
[[ "$original" =~ ^[0-9]+$ ]]
# Reject a source ACL drift, without modifying the existing schedule.
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -c 'GRANT EXECUTE ON FUNCTION public.cleanup_old_diagnostic_logs() TO anon;'
if PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -f "$migration" >"$log" 2>&1; then exit 1; fi
grep -q 'diagnostic_scheduler_source_drift' "$log"
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -c 'REVOKE EXECUTE ON FUNCTION public.cleanup_old_diagnostic_logs() FROM anon;'
duplicate="$(PGUSER=postgres psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT cron.schedule('diagnostic-duplicate','0 3 * * *','SELECT cleanup_old_diagnostic_logs()');")"
if PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -f "$migration" >"$log" 2>&1; then exit 1; fi
grep -q 'diagnostic_scheduler_identity_ambiguous' "$log"
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -c "SELECT cron.unschedule($duplicate);"
test "$(PGUSER=postgres psql -X -qAt -c "SELECT count(*) FROM cron.job WHERE jobid=$original AND schedule='0 3 * * *' AND command='SELECT cleanup_old_diagnostic_logs()';")" = 1
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -f "$migration"
test "$(PGUSER=postgres psql -X -qAt -c "SELECT count(*) FROM cron.job WHERE jobid=$original AND jobname='cleanup-diagnostic-logs' AND schedule='4-59/5 * * * *' AND active;")" = 1
# Disable only the approved-shaped fixture job; retain its identity/source.
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 -c "SELECT cron.alter_job($original,active:=false);"
test "$(PGUSER=postgres psql -X -qAt -c "SELECT count(*) FROM cron.job WHERE jobid=$original AND NOT active;")" = 1
command="SET lock_timeout='1s'; SET statement_timeout='10s'; SELECT public.cleanup_old_diagnostic_logs();"
probe="$(PGUSER=postgres psql -X -qAt -v ON_ERROR_STOP=1 -v command="$command" <<'SQL'
SELECT cron.schedule('diagnostic-ci-probe','* * * * *',:'command');
SQL
)"
[[ "$probe" =~ ^[0-9]+$ ]]
for i in {1..210}; do
  count="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM cron.job_run_details WHERE jobid=$probe AND status='succeeded';")"
  failed="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM cron.job_run_details WHERE jobid=$probe AND status='failed';")"
  test "$failed" = 0
  [[ "$count" -ge 3 ]] && break
  sleep 1
done
test "$count" -ge 3
test "$(PGUSER=postgres psql -X -qAt -c "SELECT count(*) FROM retention_private.diagnostic_checkpoint c JOIN LATERAL(SELECT start_time,end_time FROM cron.job_run_details WHERE jobid=$probe AND status='succeeded' ORDER BY runid DESC LIMIT 1) r ON true WHERE c.last_started_at>=r.start_time AND c.updated_at<=r.end_time;")" = 1
echo DIAGNOSTIC_RETENTION_THREE_REAL_SCHEDULER_TICKS_PASS
