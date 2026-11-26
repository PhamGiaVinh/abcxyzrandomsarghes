#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_l02
command -v python3 >/dev/null
work="$(mktemp -d)"
printf 'L02_SUPPLEMENT_EVIDENCE_DIR=%s\n' "$work"
pids=()
trap 'for pid in "${pids[@]}"; do wait "$pid" || true; done' EXIT
psql -XqAt -v ON_ERROR_STOP=1 -f tests/staffSalary/l02Payment.adjustment.fixture.sql >"$work/fixture"
owner='16920000-0000-4000-8000-000000000001'
accountant_a='16920000-0000-4000-8000-000000000002'
accountant_b='16920000-0000-4000-8000-000000000003'
employee='16920000-0000-4000-8000-000000000004'
staff='16920000-0000-4000-8000-000000000021'
club='16920000-0000-4000-8000-000000000011'
call() {
  local actor="$1" expression="$2"
  psql -XqAt -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$actor';
SELECT $expression;
COMMIT;
SQL
}
await_wait() {
  local app="$1" event="$2"
  for _ in $(seq 1 50); do
    if [[ "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='$app' AND (wait_event='$event' OR wait_event_type='$event'))")" == t ]]; then
      psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT jsonb_agg(jsonb_build_object('pid',pid,'name',application_name,'wait_type',wait_event_type,'wait',wait_event)) FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'l02-supp-%'" >>"$work/witnesses"
      return 0
    fi
    sleep 0.1
  done
  return 1
}

PGAPPNAME=l02-supp-checkout-a call "$employee" "public.staff_check_out('$staff')" >"$work/checkout-a" &
first=$!;pids+=("$first")
await_wait l02-supp-checkout-a PgSleep
PGAPPNAME=l02-supp-checkout-b call "$employee" "public.staff_check_out('$staff')" >"$work/checkout-b" &
second=$!;pids+=("$second")
await_wait l02-supp-checkout-b Lock
wait "$first";wait "$second"
python3 - "$work" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
assert json.loads((root / 'checkout-a').read_text())['outcome'] == 'checked_out'
assert json.loads((root / 'checkout-b').read_text())['outcome'] == 'no_open_shift'
PY
call "$owner" "public.get_staff_salary_adjustments_v1('$club',2026,11)" >"$work/pending"
request="$(python3 - "$work/pending" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    requests = json.load(stream)['requests']
assert len(requests) == 1
assert requests[0]['amount_vnd'] == 200000 and requests[0]['state'] == 'pending'
print(requests[0]['id'])
PY
)"
[[ "$request" =~ ^[a-f0-9-]{36}$ ]]

PGAPPNAME=l02-supp-approve-a call "$owner" "public.approve_staff_salary_adjustment_v1('$request')" >"$work/approve-a" &
first=$!;pids+=("$first")
await_wait l02-supp-approve-a PgSleep
PGAPPNAME=l02-supp-approve-b call "$owner" "public.approve_staff_salary_adjustment_v1('$request')" >"$work/approve-b" &
second=$!;pids+=("$second")
await_wait l02-supp-approve-b Lock
wait "$first";wait "$second"
python3 - "$work" "$request" <<'PY'
import json, pathlib, sys
root, request = pathlib.Path(sys.argv[1]), sys.argv[2]
for suffix, replay in [('a', False), ('b', True)]:
    result = json.loads((root / ('approve-' + suffix)).read_text())
    assert result['status'] == 'approved' and result['run_id'] == request
    assert result['idempotent'] is replay
PY

expression="public.mark_staff_salary_paid('$request','bank_transfer','TEST-PORTABLE-SUPPLEMENT')"
PGAPPNAME=l02-supp-pay-a call "$accountant_a" "$expression" >"$work/pay-a" &
first=$!;pids+=("$first")
await_wait l02-supp-pay-a PgSleep
PGAPPNAME=l02-supp-pay-b call "$accountant_b" "$expression" >"$work/pay-b" &
second=$!;pids+=("$second")
await_wait l02-supp-pay-b Lock
wait "$first";wait "$second"
python3 - "$work" "$request" <<'PY'
import json, pathlib, sys
root, request = pathlib.Path(sys.argv[1]), sys.argv[2]
results = [json.loads((root / ('pay-' + suffix)).read_text()) for suffix in ['a', 'b']]
for result, replay in zip(results, [False, True]):
    assert result['status'] == 'paid' and result['run_id'] == request and result['net_vnd'] == 200000
    assert result['idempotent'] is replay
assert results[0]['paid_at'] == results[1]['paid_at']
PY
psql -XqAt -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 ASSERT(SELECT count(*) FROM public.staff_salary_runs WHERE staff_id='16920000-0000-4000-8000-000000000021')=2;
 ASSERT(SELECT sum(net_vnd) FROM public.staff_salary_runs WHERE staff_id='16920000-0000-4000-8000-000000000021' AND status='paid')=5200000;
 ASSERT(SELECT count(*)=1 AND sum(amount_vnd)=200000 FROM l02_supplement_race.effective_payments);
 ASSERT NOT EXISTS(SELECT 1 FROM l02_supplement_race.original_base b JOIN public.staff_salary_runs r ON r.id=b.run_id JOIN floor_private.staff_salary_sources_v1 s ON s.run_id=r.id WHERE to_jsonb(r) IS DISTINCT FROM b.record OR s.snapshot IS DISTINCT FROM b.source),'original5M receipt/source changed';
END $$;
SQL
printf 'PASS two checkouts→one pending200k; two approvals→one child; two accountants→one effective200k payment; original5M+source unchanged\n'
