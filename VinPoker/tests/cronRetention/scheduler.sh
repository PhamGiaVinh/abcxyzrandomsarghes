#!/usr/bin/env bash
# Exercise the exact installed command through real pg_cron as hosted postgres.
set -euo pipefail
sql='SET lock_timeout='"'"'1s'"'"'; SET statement_timeout='"'"'10s'"'"'; SELECT public.cleanup_cron_job_run_details(5000);'
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 \
 -f VinPoker/supabase/migrations/20270128000332_schedule_bounded_cron_history_retention.sql
probe="$(PGUSER=postgres psql -X -qAt -v ON_ERROR_STOP=1 -v command="$sql" <<'SQL'
SELECT cron.schedule('cron-history-ci-probe','* * * * *',:'command');
SQL
)"
[[ "$probe" =~ ^[0-9]+$ ]]
trap 'PGUSER=postgres psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT cron.unschedule($probe); SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='"'"'retention-cron-history'"'"';"' EXIT
status=''
for i in {1..90}; do
  status="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT status FROM cron.job_run_details WHERE jobid=$probe ORDER BY runid DESC LIMIT 1;")"
  [[ "$status" = succeeded ]] && break
  if [[ "$status" = failed ]]; then echo CRON_RETENTION_REAL_SCHEDULER_FAILED >&2; exit 1; fi
  sleep 1
done
test "$status" = succeeded
# A cron "1 row" receipt is not a deletion count. Verify persisted, private
# invocation telemetry was committed by the actual scheduled function call.
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -v probe="$probe" <<'SQL'
SELECT count(*) FROM retention_private.cron_history_checkpoint c
JOIN LATERAL(SELECT start_time FROM cron.job_run_details
 WHERE jobid=:probe AND status='succeeded' ORDER BY runid DESC LIMIT 1) r ON true
WHERE c.last_started_at>=r.start_time AND c.updated_at>=c.last_started_at
 AND c.last_deleted<=c.last_inspected AND c.total_deleted<=c.total_inspected;
SQL
)" = 1
echo CRON_RETENTION_REAL_SCHEDULER_PASS
