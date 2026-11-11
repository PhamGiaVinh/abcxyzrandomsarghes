#!/usr/bin/env bash
# Actual functions: block managed-table acquisition until a response crosses
# the 10-minute boundary. Candidate uses its phase-start wall-clock snapshot.
set -euo pipefail
[[ "$PGDATABASE" == vinpoker_swing_observer_test_* ]]
gate="$(mktemp -d)";holder='';worker=''
cleanup(){ touch "$gate/release";if [[ -n "$holder" ]];then wait "$holder" || true;fi;if [[ -n "$worker" ]];then wait "$worker" || true;fi;rm -rf "$gate"; }
trap cleanup EXIT
for function in observer_window_baseline observe_process_swing_cron;do
 rm -f "$gate/ready" "$gate/release"
 deadline="$(psql -X -qAt -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.process_swing_dispatch_runs;
INSERT INTO public.clubs VALUES('11111111-1111-4111-8111-111111111111') ON CONFLICT DO NOTHING;
UPDATE net._http_response SET created=clock_timestamp()-interval '595 seconds' WHERE id=3;
INSERT INTO public.process_swing_dispatch_runs(run_id,request_id,club_id,tick_at,request_fingerprint,net_request_id,requested_at,lease_token,lease_expires_at,business_state)
VALUES(gen_random_uuid(),gen_random_uuid(),'11111111-1111-4111-8111-111111111111',now(),'boundary',3,clock_timestamp(),gen_random_uuid(),now()+interval '1 minute','started');
SELECT extract(epoch FROM created+interval '600 seconds') FROM net._http_response WHERE id=3;
SQL
)"
 [[ "$deadline" =~ ^[0-9]+[.][0-9]+$ ]]
 psql -X -qAt -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
LOCK TABLE net._http_response IN ACCESS EXCLUSIVE MODE;
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
 holder=$!
 for i in {1..100};do [[ -f "$gate/ready" ]] && break;sleep 0.05;done
 test -f "$gate/ready"
 PGUSER=postgres PGAPPNAME=swing-observer-boundary-test psql -X -qAt -v ON_ERROR_STOP=1 >"$gate/result.json" 2>"$gate/worker.log" <<SQL &
SET statement_timeout='15s';
SELECT public.$function(100);
SQL
 worker=$!;waiting=0
 for i in {1..100};do
  waiting="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='swing-observer-boundary-test' AND wait_event_type='Lock';")"
  [[ "$waiting" = 1 ]] && break;sleep 0.05
 done
 test "$waiting" = 1
 # Confirm the candidate sampled cutoff before the response aged out.
 test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT clock_timestamp()<to_timestamp($deadline);")" = t
 sleep 6
 test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT clock_timestamp()>to_timestamp($deadline);")" = t
 touch "$gate/release";wait "$holder";holder='';wait "$worker";worker=''
 expected=0;[[ "$function" = observe_process_swing_cron ]] && expected=1
 node --input-type=module - "$gate/result.json" "$expected" "$function" <<'JS'
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const result=JSON.parse(readFileSync(process.argv[2],'utf8'));assert.equal(result.observed,Number(process.argv[3]));assert.equal(result.timed_out,0);
console.log(JSON.stringify({kind:'ACTUAL_OBSERVER_BOUNDARY_TRANSITION',function:process.argv[4],result,expectedEquivalent:false,productionChanged:false}));
JS
done
