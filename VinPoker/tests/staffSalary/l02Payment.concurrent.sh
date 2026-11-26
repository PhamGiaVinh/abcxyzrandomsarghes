#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_l02
psql -X -v ON_ERROR_STOP=1 -f tests/staffSalary/l02Payment.fixture.sql
psql -X -v ON_ERROR_STOP=1 -f tests/staffSalary/l02Payment.audit.sql
work="$(mktemp -d)"
printf 'L02_EVIDENCE_DIR=%s\n' "$work"
run='16680000-0000-4000-8000-000000000031'
accountant='16680000-0000-4000-8000-000000000002'
second_accountant='16680000-0000-4000-8000-000000000003'
pay() {
  local actor="$1" method="$2" reference="$3" hold="$4"
  psql -XqAt -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$actor';
SELECT public.mark_staff_salary_paid('$run','$method',$reference);
SELECT pg_sleep($hold);
COMMIT;
SQL
}
await_wait() {
  local app="$1" event="$2"
  for _ in $(seq 1 40); do
    if [[ "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$app' AND (wait_event='$event' OR wait_event_type='$event'))")" == t ]]; then
      printf 'OBSERVED_%s_%s\n' "$app" "$event"
      return 0
    fi
    sleep 0.1
  done
  return 1
}
PGAPPNAME=l02-first pay "$accountant" bank_transfer "'TEST-L02-TRANSFER'" 9 >"$work/first" &
first=$!
await_wait l02-first PgSleep
PGAPPNAME=l02-second pay "$second_accountant" bank_transfer "'TEST-L02-TRANSFER'" 0 >"$work/second" &
second=$!
await_wait l02-second Lock
wait "$first"
wait "$second"
head -n 1 "$work/first" | jq -e --arg run "$run" '.status=="paid" and .run_id==$run and .paid_at!=null'
head -n 1 "$work/second" | jq -e --arg run "$run" '.status=="paid" and .run_id==$run and .idempotent==true'
pay "$accountant" bank_transfer "'TEST-L02-TRANSFER'" 0 >"$work/retry"
head -n 1 "$work/retry" | jq -e --arg run "$run" '.status=="paid" and .run_id==$run and .idempotent==true'
[[ "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.staff_salary_runs WHERE id='$run' AND status='paid' AND net_vnd=5000000 AND payment_method='bank_transfer' AND payment_reference='TEST-L02-TRANSFER' AND paid_by='$accountant'")" == 1 ]]
[[ "$(psql -XqAt -v ON_ERROR_STOP=1 -c 'SELECT count(*) FROM l02_payment_fixture.effective_payments')" == 1 ]]
[[ "$(psql -XqAt -v ON_ERROR_STOP=1 -c 'SELECT sum(amount) FROM l02_payment_fixture.effective_payments')" == 5000000 ]]
psql -X -v ON_ERROR_STOP=1 -f tests/staffSalary/l02Payment.intent.sql
psql -X -v ON_ERROR_STOP=1 -f tests/staffSalary/l02Payment.input.sql
