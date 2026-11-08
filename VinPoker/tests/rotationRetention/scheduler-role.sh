#!/usr/bin/env bash
# Disposable PostgreSQL only: retain a separate bootstrap admin, then reproduce
# hosted postgres (non-superuser) rather than qualifying scheduling as superuser.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
old="$root/supabase/migration-archive/historical-never-replay/20270128000327_schedule_rotation_retention.sql"
candidate="$root/supabase/migrations/20270128000328_schedule_rotation_retention_current_role.sql"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE rotation_test_admin LOGIN SUPERUSER PASSWORD 'test';
GRANT USAGE ON SCHEMA cron TO postgres;
ALTER ROLE postgres NOSUPERUSER;
SQL
failure="$(mktemp)"
trap 'rm -f "$failure"' EXIT
if psql -X -v ON_ERROR_STOP=1 -f "$old" >"$failure" 2>&1; then
  echo 'Regression fixture did not reproduce explicit-username denial' >&2
  exit 1
fi
grep -q 'must be superuser to create a job for another role' "$failure"
test "$(psql -X -qAt -c "SELECT count(*) FROM cron.job WHERE jobname='retention-rotation-schedule';")" = 0
if PGUSER=rotation_test_admin psql -X -v ON_ERROR_STOP=1 -f "$candidate" >"$failure" 2>&1; then
  echo 'Wrong scheduling actor unexpectedly accepted' >&2
  exit 1
fi
grep -q 'rotation_retention_scheduler_requires_postgres' "$failure"
psql -X -v ON_ERROR_STOP=1 -f "$candidate"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM cron.job WHERE jobname='retention-rotation-schedule' AND username='postgres' AND database=current_database() AND active AND schedule='3-59/5 * * * *';")" = 1
if psql -X -v ON_ERROR_STOP=1 -f "$candidate" >"$failure" 2>&1; then
  echo 'Duplicate scheduler apply unexpectedly accepted' >&2
  exit 1
fi
grep -q 'rotation_retention_job_already_exists' "$failure"
test "$(psql -X -qAt -c "SELECT count(*) FROM cron.job WHERE jobname='retention-rotation-schedule';")" = 1
echo 'ROTATION_RETENTION_NON_SUPERUSER_SCHEDULER_PASS'
