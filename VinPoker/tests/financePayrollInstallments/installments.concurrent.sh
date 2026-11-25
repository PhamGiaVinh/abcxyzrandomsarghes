#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_pt_installment
out="$1"
mkdir -p "$out"
db() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }
# Reuse the same real earnings/finalizer setup as the sequential acceptance case.
# Stop before its pay block; the preceding transaction remains open on this connection.
printf '%s\n' '\ir tests/financePayrollInstallments/installments.seed.sql' > "$out/setup.sql"
cat >> "$out/setup.sql" <<'SQL'
SELECT public.approve_pt_statement_installments_v1(current_setting('test.pt_statement_id')::uuid,
 current_setting('test.pt_statement_hash'),'18000000-0000-4000-8000-000000000092','TEST owner approves 5M budget');
SELECT public.record_pt_statement_installment_v1(current_setting('test.pt_statement_id')::uuid,
 current_setting('test.pt_statement_hash'),2000000,'bank','TEST first 2M',
 '18000000-0000-4000-8000-000000000093','TEST starting partial debt');
COMMIT;
SQL
db -f "$out/setup.sql" > "$out/setup.jsonl"
db -c "INSERT INTO auth.users(id) VALUES ('18000000-0000-4000-8000-000000000012'); INSERT INTO public.club_cashiers(club_id,user_id) VALUES ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000012');"
statement_id="$(db -c 'SELECT statement_id FROM public.finance_pt_installment_plans_v1')"
statement_hash="$(db -c 'SELECT statement_hash FROM public.finance_pt_installment_plans_v1')"
test -n "$statement_id"
PGAPPNAME=pt-installment-first db > "$out/first.jsonl" 2> "$out/first.err" <<SQL &
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000011';
SELECT public.record_pt_statement_installment_v1('$statement_id','$statement_hash',3000000,'cash',NULL,
 '18000000-0000-4000-8000-000000000095','TEST competing remainder A');
SELECT pg_sleep(3);
COMMIT;
SQL
first_pid=$!
ready=false
for _ in $(seq 1 100); do
  if [[ "$(db -c "SELECT coalesce((SELECT wait_event FROM pg_stat_activity WHERE application_name='pt-installment-first'),'none')")" = PgSleep ]]; then ready=true; break; fi
  kill -0 "$first_pid" 2>/dev/null || break
  sleep 0.025
done
test "$ready" = true
PGAPPNAME=pt-installment-second psql -XqAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$out/second.jsonl" 2> "$out/second.err" <<SQL &
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000012';
SELECT public.record_pt_statement_installment_v1('$statement_id','$statement_hash',3000000,'cash',NULL,
 '18000000-0000-4000-8000-000000000096','TEST competing remainder B');
COMMIT;
SQL
second_pid=$!
blocked=false
for _ in $(seq 1 100); do
  if [[ "$(db -c "SELECT EXISTS(SELECT FROM pg_stat_activity first,pg_stat_activity second WHERE first.application_name='pt-installment-first' AND second.application_name='pt-installment-second' AND first.pid=ANY(pg_blocking_pids(second.pid)))")" = t ]]; then blocked=true; break; fi
  kill -0 "$second_pid" 2>/dev/null || break
  sleep 0.025
done
test "$blocked" = true
wait "$first_pid"
second_status=0
wait "$second_pid" || second_status=$?
test "$second_status" != 0
grep -q '22023:.*PT_INSTALLMENT_AMOUNT_EXCEEDS_REMAINING' "$out/second.err"
test "$(db -c "SELECT count(*)||':'||sum(amount_vnd)||':'||sum(minutes_paid) FROM public.dealer_pt_wage_payments WHERE statement_id='$statement_id'")" = 2:5000000:6000
test "$(db -c "SELECT status FROM public.dealer_pt_wage_settlements WHERE statement_id='$statement_id'")" = paid
echo PT_DISTINCT_REQUESTS_ACTUAL_BLOCKING_BARRIER_NO_OVERSPEND_PASS
