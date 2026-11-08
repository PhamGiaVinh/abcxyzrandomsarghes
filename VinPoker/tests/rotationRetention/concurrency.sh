#!/usr/bin/env bash
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
club=e1000000-0000-4000-8000-000000000001
psql -X -v ON_ERROR_STOP=1 >"$work/lock.log" <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rotation-retention:$club',0));
\echo LOCK_READY
SELECT pg_sleep(3);
COMMIT;
SQL
holder=$!
for i in {1..50}; do grep -q LOCK_READY "$work/lock.log" && break; sleep 0.1; done
grep -q LOCK_READY "$work/lock.log"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT public.cleanup_dealer_rotation_schedule('$club',5000)->>'outcome';")" = busy
wait "$holder"

# Row locks held by a different writer must be skipped, not waited on/deleted.
psql -X -v ON_ERROR_STOP=1 >"$work/rows.log" <<SQL &
BEGIN;
SELECT status AS locked_status FROM public.dealer_rotation_schedule
 WHERE club_id='$club' AND status IN('superseded','executed','cancelled','no_show')
 AND planned_relief_at<now()-interval '90 days'
 ORDER BY planned_relief_at,status LIMIT 1 \gset
SELECT id FROM public.dealer_rotation_schedule WHERE club_id='$club' AND status=:'locked_status'
 ORDER BY planned_relief_at LIMIT 100 FOR UPDATE;
\echo ROWS_READY
SELECT pg_sleep(3);
COMMIT;
SQL
holder=$!
for i in {1..50}; do grep -q ROWS_READY "$work/rows.log" && break; sleep 0.1; done
grep -q ROWS_READY "$work/rows.log"
PGOPTIONS='-c statement_timeout=2000 -c lock_timeout=500' psql -X -qAt -v ON_ERROR_STOP=1 \
 -c "SELECT public.cleanup_dealer_rotation_schedule('$club',5000)->>'deleted';" >"$work/result"
test "$(cat "$work/result")" = 5000
wait "$holder"
echo 'ROTATION_RETENTION_CONCURRENCY_PASS'
