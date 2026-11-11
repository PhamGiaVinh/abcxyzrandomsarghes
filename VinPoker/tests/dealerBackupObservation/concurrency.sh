#!/usr/bin/env bash
# Disposable fixture only. A committed terminal observation must not be
# overwritten by a worker that read pending before the concurrent commit.
set -euo pipefail
[[ "$PGDATABASE" == vinpoker_backup_observation_test_* ]]
gate="$(mktemp -d)";holder='';worker=''
cleanup() {
  touch "$gate/release"
  if [[ -n "$holder" ]]; then wait "$holder" || true; fi
  if [[ -n "$worker" ]]; then wait "$worker" || true; fi
  rm -rf "$gate"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 <<'SQL'
UPDATE net._http_response SET created=now(),status_code=200,timed_out=false WHERE id=99999;
INSERT INTO public.dealer_ready_backup_cron_runs(request_id,requested_at,result_state) VALUES(99999,now()-interval '1 second','pending');
SQL
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
UPDATE public.dealer_ready_backup_cron_runs SET result_state='failed',error_code='timeout',observed_at=now() WHERE request_id=99999;
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
COMMIT;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
PGUSER=postgres PGAPPNAME=backup-observer-concurrent-test psql -X -v ON_ERROR_STOP=1 -c "SET statement_timeout='10s'; SELECT public.run_dealer_ready_backup_cron_v1();" >"$gate/worker.log" 2>&1 &
worker=$!
waiting=0
for i in {1..100}; do
 waiting="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='backup-observer-concurrent-test' AND wait_event_type='Lock';")"
 [[ "$waiting" = 1 ]] && break
 sleep 0.05
done
test "$waiting" = 1
touch "$gate/release";wait "$holder";holder='';wait "$worker";worker=''
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE request_id=99999 AND result_state='failed' AND error_code='timeout' AND response_status IS NULL)
 OR (SELECT count(*) FROM net.observation_test_queue)<>1 THEN
   RAISE EXCEPTION 'stale observer overwrote committed state or duplicated enqueue'; END IF;
END$$;
SET ROLE anon;
DO $$BEGIN
 BEGIN
   PERFORM public.run_dealer_ready_backup_cron_v1();
   RAISE EXCEPTION 'anonymous caller crossed service boundary';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
SQL
echo BACKUP_OBSERVER_CONCURRENT_TERMINAL_STATE_PASS
