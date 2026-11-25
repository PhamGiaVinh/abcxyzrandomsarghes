#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_pt_installment
out="$1"
mkdir -p "$out"
db() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }
owner=18000000-0000-4000-8000-000000000011
cashier=18000000-0000-4000-8000-000000000012
club=18000000-0000-4000-8000-000000000001

seed() {
  local dealer="18000000-0000-4000-8000-0000000000$1"
  local receipt
  receipt="$(db <<SQL
SET request.jwt.claim.sub='$owner';
INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,hourly_rate_vnd)
 VALUES('$dealer','$club','PT competing-writer TEST $1','active','part_time',50000);
INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by)
 VALUES('$dealer',50000,true,'2026-11-01T00:00:00+07:00','$owner');
INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
 SELECT '$dealer',day::date,'checked_out','checked_out',day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
 FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);
SET ROLE authenticated;
SELECT public.finalize_part_time_payroll_statement('18000000-0000-4000-8000-0000000001$1','$club','$dealer','TEST actual competing writers');
SQL
)"
  jq -e '.net_amount_vnd==5000000' <<<"$receipt" >/dev/null
  sid="$(jq -r '.statement_id' <<<"$receipt")"
  hash="$(db -c "SELECT statement_hash FROM public.dealer_payroll_statements WHERE id='$sid'")"
  adopt="SELECT public.approve_pt_statement_installments_v1('$sid','$hash','18000000-0000-4000-8000-0000000002$1','TEST concurrent adoption');"
  full="SELECT public.pay_finalized_part_time_payroll_statement('$sid','cash',NULL,'TEST competing-full-$1','TEST full writer');"
}

race() {
  local name="$1" first_sql="$2" second_sql="$3" second_actor="$4" expected="$5" revoke="${6:-false}"
  PGAPPNAME="pt-$name-first" db > "$out/$name-first.jsonl" 2> "$out/$name-first.err" <<SQL &
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$owner';
$first_sql
SELECT pg_sleep(3);
COMMIT;
SQL
  local first_pid=$! ready=false
  for _ in $(seq 1 100); do
    if [[ "$(db -c "SELECT coalesce((SELECT wait_event FROM pg_stat_activity WHERE application_name='pt-$name-first'),'none')")" = PgSleep ]]; then ready=true; break; fi
    kill -0 "$first_pid" 2>/dev/null || break
    sleep 0.025
  done
  test "$ready" = true
  PGAPPNAME="pt-$name-second" psql -XqAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose > "$out/$name-second.jsonl" 2> "$out/$name-second.err" <<SQL &
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$second_actor';
$second_sql
COMMIT;
SQL
  local second_pid=$! blocked=false
  for _ in $(seq 1 100); do
    if [[ "$(db -c "SELECT EXISTS(SELECT FROM pg_stat_activity first,pg_stat_activity second WHERE first.application_name='pt-$name-first' AND second.application_name='pt-$name-second' AND first.pid=ANY(pg_blocking_pids(second.pid)))")" = t ]]; then blocked=true; break; fi
    kill -0 "$second_pid" 2>/dev/null || break
    sleep 0.025
  done
  test "$blocked" = true
  local membership=''
  if [[ "$revoke" = true ]]; then
    membership="$(db -c "SELECT row_to_json(c)::text FROM public.club_cashiers c WHERE club_id='$club' AND user_id='$cashier'")"
    test -n "$membership"
    db -c "DELETE FROM public.club_cashiers WHERE club_id='$club' AND user_id='$cashier'"
  fi
  wait "$first_pid"
  local status=0
  wait "$second_pid" || status=$?
  test "$status" != 0
  grep -q "$expected" "$out/$name-second.err"
  if [[ "$revoke" = true ]]; then
    db -c "INSERT INTO public.club_cashiers SELECT * FROM json_populate_record(NULL::public.club_cashiers,\$row\$$membership\$row\$::json)"
  fi
  echo "PT_COMPETING_${name}_ACTUAL_BLOCKING_BARRIER_EXPECTED_REFUSAL_PASS"
}

seed 61
race adopt-before-full "$adopt" "$full" "$owner" '55000:.*PT_INSTALLMENT_USE_INSTALLMENT_API'
test "$(db -c "SELECT count(*) FROM public.dealer_pt_wage_payments WHERE statement_id='$sid'")" = 0
test "$(db -c "SELECT count(*) FROM public.finance_pt_installment_plans_v1 WHERE statement_id='$sid'")" = 1

seed 62
race full-before-adopt "$full" "$adopt" "$owner" '55000:.*PT_INSTALLMENT_UNTOUCHED_STATEMENT_REQUIRED'
test "$(db -c "SELECT count(*)||':'||sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE statement_id='$sid'")" = 1:5000000
test "$(db -c "SELECT count(*) FROM public.finance_pt_installment_plans_v1 WHERE statement_id='$sid'")" = 0

seed 63
void="SELECT public.void_dealer_payroll_statement('$sid','TEST cashier void competes with owner adoption');"
race adopt-before-cashier-void "$adopt" "$void" "$cashier" '42501:.*PAYROLL_STATEMENT_FINALIZE_FORBIDDEN'
test "$(db -c "SELECT status FROM public.dealer_pt_wage_settlements WHERE statement_id='$sid'")" = finalized
test "$(db -c "SELECT count(*) FROM public.dealer_pt_wage_payments WHERE statement_id='$sid'")" = 0

seed 64
db <<SQL > "$out/revoke-plan.jsonl"
SET ROLE authenticated;
SET request.jwt.claim.sub='$owner';
$adopt
SQL
first="SELECT public.record_pt_statement_installment_v1('$sid','$hash',2000000,'cash',NULL,'18000000-0000-4000-8000-000000000364','TEST before revocation');"
second="SELECT public.record_pt_statement_installment_v1('$sid','$hash',3000000,'cash',NULL,'18000000-0000-4000-8000-000000000464','TEST revoked while waiting');"
race revoke-while-waiting "$first" "$second" "$cashier" '42501:.*PAYROLL_STATEMENT_FORBIDDEN' true
test "$(db -c "SELECT count(*)||':'||sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE statement_id='$sid'")" = 1:2000000
test "$(db -c "SELECT status FROM public.dealer_pt_wage_settlements WHERE statement_id='$sid'")" = finalized
echo PT_LEGACY_ADOPTION_VOID_WAITING_REVOCATION_RACES_PASS
