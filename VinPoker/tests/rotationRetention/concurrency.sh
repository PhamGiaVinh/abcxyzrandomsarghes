#!/usr/bin/env bash
set -euo pipefail
work="$(mktemp -d)"
trap 'touch "$work/release"; wait || true; rm -rf -- "$work"' EXIT
club=e1000000-0000-4000-8000-000000000001
psql -X -v ON_ERROR_STOP=1 >"$work/lock.log" <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rotation-retention:$club',0));
\echo LOCK_READY
SELECT pg_sleep(5);
COMMIT;
SQL
holder=$!
for i in {1..50}; do grep -q LOCK_READY "$work/lock.log" && break; sleep 0.1; done
grep -q LOCK_READY "$work/lock.log"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT public.cleanup_dealer_rotation_schedule('$club',5000)->>'outcome';")" = busy
wait "$holder"

# Row locks held by a different writer must be skipped, not waited on/deleted.
{
cat <<SQL
BEGIN;
SELECT status AS locked_status FROM public.dealer_rotation_schedule
 WHERE club_id='$club' AND status IN('superseded','executed','cancelled','no_show')
 AND planned_relief_at<now()-interval '90 days'
 ORDER BY planned_relief_at,status LIMIT 1 \gset
SELECT id FROM public.dealer_rotation_schedule WHERE club_id='$club' AND status=:'locked_status'
 ORDER BY planned_relief_at LIMIT 100 FOR UPDATE;
\echo ROWS_READY
SQL
for i in {1..600}; do [[ -e "$work/release" ]] && break; sleep 0.05; done
echo 'COMMIT;'
} | psql -X -v ON_ERROR_STOP=1 >"$work/rows.log" &
holder=$!
for i in {1..50}; do grep -q ROWS_READY "$work/rows.log" && break; sleep 0.1; done
grep -q ROWS_READY "$work/rows.log"
timeout_ms=2000
if [[ "${ROTATION_RETENTION_BUDGET_ENABLED:-0}" = 1 ]]; then timeout_ms=6000; fi
PGOPTIONS="-c statement_timeout=$timeout_ms -c lock_timeout=500" psql -X -qAt -v ON_ERROR_STOP=1 \
 -c "SELECT public.cleanup_dealer_rotation_schedule('$club',5000)->>'deleted';" >"$work/result"
if [[ "${ROTATION_RETENTION_BUDGET_ENABLED:-0}" = 1 ]]; then
  deleted="$(cat "$work/result")"
  [[ "$deleted" =~ ^[0-9]+$ ]]
  test "$deleted" -gt 0 && test "$deleted" -le 4900
  # The first ten candidates remain held by the other session. Unlike LIMIT
  # after SKIP LOCKED, this must not scan ahead into unlocked history.
  test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT (r->>'deleted')::int=0 AND (r->>'inspected')::int=10 AND r->>'outcome'='deferred' FROM (SELECT public.cleanup_dealer_rotation_schedule('$club',10) r) x;")" = t
else
  test "$(cat "$work/result")" = 5000
fi
touch "$work/release"
wait "$holder"
echo 'ROTATION_RETENTION_CONCURRENCY_PASS'
