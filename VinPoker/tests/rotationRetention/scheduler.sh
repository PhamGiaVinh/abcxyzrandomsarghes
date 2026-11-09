#!/usr/bin/env bash
set -euo pipefail
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM cron.job WHERE jobname='retention-rotation-schedule' AND username='postgres' AND active AND schedule='3-59/5 * * * *' AND command LIKE '%statement_timeout=''10s''%';")" = 1
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT current_user='postgres' AND NOT rolsuper FROM pg_roles WHERE rolname=current_user;")" = t
probe="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT cron.schedule_in_database('retention-runtime-probe','* * * * *',(SELECT command FROM cron.job WHERE jobname='retention-rotation-schedule'),current_database(),NULL,true);")"
[[ "$probe" =~ ^[0-9]+$ ]]
cleanup() {
  psql -X -qAt -c "SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('retention-runtime-probe','retention-rotation-schedule');" >/dev/null
}
trap cleanup EXIT
for i in {1..35}; do
  status="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT status FROM cron.job_run_details WHERE jobid=$probe ORDER BY runid DESC LIMIT 1;")"
  if [[ "$status" = succeeded ]]; then
    echo 'ROTATION_RETENTION_REAL_PG_CRON_PASS'
    exit 0
  fi
  if [[ "$status" = failed ]]; then
    echo 'Real pg_cron retention command failed' >&2
    exit 1
  fi
  sleep 2
done
echo 'Real pg_cron retention command did not complete within 70 seconds' >&2
exit 1
