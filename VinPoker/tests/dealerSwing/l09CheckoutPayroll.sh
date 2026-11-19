#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_l09
out="$1"
mkdir -p "$out"
psql -Xq -v ON_ERROR_STOP=1 -f tests/dealerSwing/l09CheckoutPayroll.fixture.sql

db() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }
observe() {
  db -c "SELECT coalesce((SELECT wait_event_type || ':' || wait_event FROM pg_stat_activity WHERE application_name='$1'), 'none')"
}

while IFS='|' read -r sample workload actor payroll_actor club attendance month; do
  writer_pid=''
  if [[ "$workload" != baseline ]]; then
    PGAPPNAME="l09-writer-$sample" db > "$out/save-$sample.jsonl" <<SQL &
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$payroll_actor';
SELECT clock_timestamp() AS started \gset
SELECT public.save_payroll_period_v2('$club',extract(year FROM date '$month')::int,
  extract(month FROM date '$month')::int,date '$month',(date '$month' + interval '1 month - 1 day')::date,
  coalesce((SELECT jsonb_agg(value ORDER BY key) FROM jsonb_each(public.calculate_club_payroll(
    '$club',date '$month',(date '$month' + interval '1 month - 1 day')::date)->'dealers')), '[]'),gen_random_uuid()) AS receipt \gset
SELECT clock_timestamp() AS saved \gset
SELECT pg_sleep(0.6) \gset
SELECT clock_timestamp() AS committing \gset
COMMIT;
SELECT jsonb_build_object('outcome', :'receipt'::jsonb->>'outcome', 'rpc_ms',
  1000*extract(epoch FROM (:'saved'::timestamptz - :'started'::timestamptz)),
  'commit_ms',1000*extract(epoch FROM (clock_timestamp() - :'committing'::timestamptz)));
SQL
    writer_pid=$!
    writer_wait=''
    for _ in $(seq 1 20); do
      writer_wait=$(observe "l09-writer-$sample")
      [[ "$writer_wait" = Timeout:PgSleep ]] && break
      kill -0 "$writer_pid" 2>/dev/null || break
      sleep 0.02
    done
    test "$writer_wait" = Timeout:PgSleep
  fi

  PGAPPNAME="l09-checkout-$sample" db > "$out/checkout-$sample.jsonl" <<SQL &
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"$actor"}';
SELECT clock_timestamp() AS started \gset
SELECT public.operator_checkout_dealer_attendance_v1('$actor','$attendance') AS receipt \gset
SELECT clock_timestamp() AS committing \gset
COMMIT;
SELECT jsonb_build_object('sample',$sample,'workload','$workload','success',(:'receipt'::jsonb->>'success')::boolean,
  'rpc_ms',1000*extract(epoch FROM (:'committing'::timestamptz - :'started'::timestamptz)),
  'commit_ms',1000*extract(epoch FROM (clock_timestamp() - :'committing'::timestamptz)));
SQL
  checkout_pid=$!
  observed='none'
  if [[ -n "$writer_pid" ]]; then
    for _ in $(seq 1 12); do
      observed=$(observe "l09-checkout-$sample")
      [[ "$observed" = Lock:* ]] && break
      kill -0 "$checkout_pid" 2>/dev/null || break
      sleep 0.02
    done
    wait "$writer_pid"
    jq -e '.outcome == "saved"' "$out/save-$sample.jsonl" >/dev/null
  fi
  wait "$checkout_pid"
  jq -e -c --arg wait "$observed" 'select(.success == true) + {wait_observed:$wait}' "$out/checkout-$sample.jsonl" >> "$out/checkout.jsonl"
  test "$(db -c "SELECT count(*) FROM public.dealer_attendance WHERE id='$attendance' AND status='checked_out' AND check_out_time IS NOT NULL AND total_worked_minutes_today >= 0")" = 1
done < <(db -F '|' -c 'SELECT sample,workload,actor_id,payroll_actor_id,payroll_club_id,attendance_id,month_start FROM public.l09_checkout_fixture ORDER BY sample')

jq -s '
  if length != 80 then error("incomplete checkout capture") else
    group_by(.workload) | map({workload:.[0].workload, samples:length,
      lock_wait_samples:([.[] | select(.wait_observed | startswith("Lock:"))] | length),
      rpc_p95_ms: (sort_by(.rpc_ms) | .[((length * 0.95 | ceil) - 1)].rpc_ms),
      commit_p95_ms: (sort_by(.commit_ms) | .[((length * 0.95 | ceil) - 1)].commit_ms)})
  end' "$out/checkout.jsonl" | tee "$out/summary.json"
