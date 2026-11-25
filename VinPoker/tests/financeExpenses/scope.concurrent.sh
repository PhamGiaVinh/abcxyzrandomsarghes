#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_finance_expense
out="$1"
mkdir -p "$out"
db() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }
db <<'SQL'
BEGIN;
\ir tests/financeExpenses/scope.seed.sql
COMMIT;
SQL
observe() {
  db -c "SELECT coalesce((SELECT wait_event_type||':'||wait_event FROM pg_stat_activity WHERE application_name='$1'),'none')"
}
for kind in same conflicting; do
  second_amount=10000
  [[ "$kind" = conflicting ]] && second_amount=20000
  PGAPPNAME="expense-first-$kind" db > "$out/first-$kind.jsonl" 2> "$out/first-$kind.err" <<SQL &
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='17980000-0000-4000-8000-000000000033';
SELECT public.record_club_expense('17980000-0000-4000-8000-000000000001','misc',10000,
 '2026-11-25T10:00:00Z','TEST concurrent','unpaid',NULL,NULL,NULL,NULL,NULL,'expense-race-$kind');
SELECT pg_sleep(3);
COMMIT;
SQL
  first_pid=$!
  first_ready=false
  for _ in $(seq 1 80); do
    if [[ "$(observe "expense-first-$kind")" = Timeout:PgSleep ]]; then first_ready=true; break; fi
    kill -0 "$first_pid" 2>/dev/null || break
    sleep 0.025
  done
  test "$first_ready" = true
  PGAPPNAME="expense-second-$kind" psql -XqAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$out/second-$kind.jsonl" 2> "$out/second-$kind.err" <<SQL &
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='17980000-0000-4000-8000-000000000011';
SELECT public.record_club_expense('17980000-0000-4000-8000-000000000001','misc',$second_amount,
 '2026-11-25T10:00:00Z','TEST concurrent','unpaid',NULL,NULL,NULL,NULL,NULL,'expense-race-$kind');
COMMIT;
SQL
  second_pid=$!
  lock_seen=false
  for _ in $(seq 1 80); do
    if [[ "$(observe "expense-second-$kind")" = Lock:transactionid ]]; then lock_seen=true; break; fi
    kill -0 "$second_pid" 2>/dev/null || break
    sleep 0.025
  done
  test "$lock_seen" = true
  wait "$first_pid"
  second_status=0
  wait "$second_pid" || second_status=$?
  if [[ "$kind" = same ]]; then
    test "$second_status" = 0
    jq -e '.status=="ok" and .idempotent==false' "$out/first-$kind.jsonl" >/dev/null
    jq -e '.status=="ok" and .idempotent==true' "$out/second-$kind.jsonl" >/dev/null
    test "$(jq -r '.expense_id' "$out/first-$kind.jsonl")" = "$(jq -r '.expense_id' "$out/second-$kind.jsonl")"
  else
    test "$second_status" != 0
    grep -q '22023:.*expense_idempotency_conflict' "$out/second-$kind.err"
  fi
  test "$(db -c "SELECT count(*)||':'||min(amount_vnd) FROM public.club_expenses WHERE idempotency_key='expense-race-$kind'")" = 1:10000
  echo "EXPENSE_RACE_${kind}_OBSERVED_LOCK_EXACTLY_ONE_ROW_PASS"
done
