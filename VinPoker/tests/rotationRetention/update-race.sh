#!/usr/bin/env bash
# Actual two-session cursor/update race. Disposable PostgreSQL only.
set -euo pipefail
work="$(mktemp -d)"
cleanup() {
  touch "$work/release"
  wait || true
  psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DROP TRIGGER IF EXISTS rotation_budget_race_gate ON public.dealer_rotation_schedule;
DROP FUNCTION IF EXISTS public.rotation_budget_race_gate();
DELETE FROM public.dealer_rotation_schedule WHERE id::text LIKE 'e7000000-%';
DELETE FROM public.game_tables WHERE id::text LIKE 'e6000000-%';
DELETE FROM public.clubs WHERE id::text LIKE 'e5000000-%';
SQL
  rm -rf -- "$work"
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.clubs(id,name) VALUES
 ('e5000000-0000-4000-8000-000000000001','RACE A'),('e5000000-0000-4000-8000-000000000002','RACE B');
INSERT INTO public.game_tables(id,club_id,table_name) VALUES
 ('e6000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','RACE A'),
 ('e6000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000002','RACE B');
INSERT INTO public.dealer_rotation_schedule(id,club_id,table_id,slot_index,planned_relief_at,status)
SELECT ('e7000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 'e5000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001',g-1,
 now()-interval '100 days'-make_interval(secs=>6-g),'superseded' FROM generate_series(1,5) g;
CREATE FUNCTION public.rotation_budget_race_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('rotation-budget-race',0)); RETURN OLD; END $$;
CREATE TRIGGER rotation_budget_race_gate BEFORE DELETE ON public.dealer_rotation_schedule
 FOR EACH ROW WHEN(OLD.id='e7000000-0000-4000-8000-000000000001') EXECUTE FUNCTION public.rotation_budget_race_gate();
SQL
{
cat <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rotation-budget-race',0));
\echo GATE_READY
SQL
for i in {1..600}; do [[ -e "$work/release" ]] && break; sleep 0.05; done
echo 'COMMIT;'
} | psql -X -v ON_ERROR_STOP=1 >"$work/gate.log" &
holder=$!
for i in {1..100}; do grep -q GATE_READY "$work/gate.log" && break; sleep 0.02; done
grep -q GATE_READY "$work/gate.log"
cleanup_sql="SELECT public.cleanup_dealer_rotation_schedule('e5000000-0000-4000-8000-000000000001',5);"
if [[ "${ROTATION_RETENTION_CHECKPOINT_ENABLED:-0}" = 1 ]]; then
  cleanup_sql='SELECT public.cleanup_next_dealer_rotation_schedule(5);'
fi
PGAPPNAME=rotation-budget-race-cleanup psql -X -qAt -v ON_ERROR_STOP=1 \
 -c "$cleanup_sql" >"$work/result" &
cleaner=$!
ready=0
for i in {1..100}; do
  ready="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='rotation-budget-race-cleanup' AND wait_event_type='Lock' AND wait_event='advisory';")"
  [[ "$ready" = 1 ]] && break
  sleep 0.01
done
test "$ready" = 1
# First candidate is paused after cursor opening. Change later candidates in
# another committed transaction before cleanup fetches/deletes their old ctids.
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE public.dealer_rotation_schedule SET status='executing' WHERE id='e7000000-0000-4000-8000-000000000002';
UPDATE public.dealer_rotation_schedule SET club_id='e5000000-0000-4000-8000-000000000002',table_id='e6000000-0000-4000-8000-000000000002'
 WHERE id='e7000000-0000-4000-8000-000000000003';
UPDATE public.dealer_rotation_schedule SET planned_relief_at=now() WHERE id='e7000000-0000-4000-8000-000000000004';
COMMIT;
SQL
touch "$work/release"
wait "$holder"
wait "$cleaner"
grep -q '"inspected": 5' "$work/result"
grep -q '"deleted": 2' "$work/result"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*)=3 AND count(*) FILTER(WHERE id='e7000000-0000-4000-8000-000000000002' AND status='executing')=1 AND count(*) FILTER(WHERE id='e7000000-0000-4000-8000-000000000003' AND club_id='e5000000-0000-4000-8000-000000000002')=1 AND count(*) FILTER(WHERE id='e7000000-0000-4000-8000-000000000004' AND planned_relief_at>now()-interval '1 minute')=1 FROM public.dealer_rotation_schedule WHERE id::text LIKE 'e7000000-%';")" = t
echo ROTATION_RETENTION_CURSOR_UPDATE_RACE_PASS
