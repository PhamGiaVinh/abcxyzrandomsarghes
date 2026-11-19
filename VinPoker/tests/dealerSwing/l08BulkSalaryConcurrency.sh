#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_l09

db() { psql -XqAt -v ON_ERROR_STOP=1 "$@"; }

IFS='|' read -r owner second club dealer period saved < <(db <<'SQL'
BEGIN;
SELECT gen_random_uuid() AS owner, gen_random_uuid() AS second,
       gen_random_uuid() AS club, gen_random_uuid() AS dealer,
       gen_random_uuid() AS period, gen_random_uuid() AS saved \gset
INSERT INTO auth.users(id) VALUES (:'owner'), (:'second');
INSERT INTO public.profiles(user_id, display_name) VALUES (:'owner', 'L08 owner'), (:'second', 'L08 operator');
INSERT INTO public.clubs(id, owner_id, name, region, status) VALUES (:'club', :'owner', 'L08 TEST', 'TEST', 'approved');
INSERT INTO public.club_dealer_controls(club_id, user_id) VALUES (:'club', :'second');
INSERT INTO public.dealers(id, club_id, full_name, status, employment_type, hourly_rate_vnd, monthly_salary_vnd)
VALUES (:'dealer', :'club', 'L08 dealer', 'active', 'part_time', 50000, 0);
INSERT INTO public.payroll_periods(id, club_id, period_start, period_end, period_month, period_year, status)
VALUES (:'period', :'club', '2026-01-01', '2026-01-31', 1, 2026, 'locked');
INSERT INTO public.dealer_payroll(id, period_id, club_id, dealer_id, employment_type, status,
  gross_pay_vnd, net_pay_after_tax_vnd, net_pay_vnd, total_hours)
VALUES (:'saved', :'period', :'club', :'dealer', 'part_time', 'pending', 500000, 500000, 500000, 10);
COMMIT;
SELECT :'owner', :'second', :'club', :'dealer', :'period', :'saved';
SQL
)

locked_snapshot() {
  db -c "SELECT md5(to_jsonb(p)::text || to_jsonb(d)::text) FROM public.payroll_periods p
    JOIN public.dealer_payroll d ON d.period_id=p.id WHERE p.id='$period' AND p.status='locked' AND d.id='$saved'"
}
before=$(locked_snapshot)
test -n "$before"

scratch=$(mktemp -d)
trap 'rm -f "$scratch/first" "$scratch/second"; rmdir "$scratch"' EXIT
PGAPPNAME=l08-first db > "$scratch/first" <<SQL &
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$owner';
UPDATE public.dealers SET hourly_rate_vnd=70000, monthly_salary_vnd=0
WHERE club_id='$club' AND id='$dealer' AND employment_type='part_time'
  AND hourly_rate_vnd=50000 AND monthly_salary_vnd=0 RETURNING hourly_rate_vnd;
SELECT pg_sleep(3) \gset
COMMIT;
SQL
first_pid=$!

for _ in $(seq 1 60); do
  [[ $(db -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='l08-first' AND wait_event='PgSleep'") == 1 ]] && break
  sleep 0.05
done

PGAPPNAME=l08-second db > "$scratch/second" <<SQL &
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$second';
UPDATE public.dealers SET hourly_rate_vnd=90000, monthly_salary_vnd=0
WHERE club_id='$club' AND id='$dealer' AND employment_type='part_time'
  AND hourly_rate_vnd=50000 AND monthly_salary_vnd=0 RETURNING hourly_rate_vnd;
COMMIT;
SQL
second_pid=$!
observed=0
for _ in $(seq 1 30); do
  observed=$(db -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='l08-second' AND wait_event_type='Lock'")
  [[ "$observed" == 1 ]] && break
  kill -0 "$second_pid" 2>/dev/null || break
  sleep 0.05
done
wait "$first_pid"
wait "$second_pid"
test "$observed" = 1
test "$(cat "$scratch/first")" = 70000
test ! -s "$scratch/second"
test "$(db -c "SELECT hourly_rate_vnd FROM public.dealers WHERE id='$dealer'")" = 70000
test "$(locked_snapshot)" = "$before"
echo 'Concurrent stale rate was rejected after waiting for the first writer.'
echo 'Saved payroll record and locked period remained unchanged.'
