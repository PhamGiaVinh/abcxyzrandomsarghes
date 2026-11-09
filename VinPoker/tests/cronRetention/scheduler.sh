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
echo CRON_RETENTION_REAL_SCHEDULER_PASS

