#!/usr/bin/env bash
set -euo pipefail
[[ "$PGDATABASE" == vinpoker_swing_observer_test_* ]]
gate="$(mktemp -d)";holder=''
cleanup(){ touch "$gate/release"; if [[ -n "$holder" ]];then wait "$holder" || true;fi;rm -rf "$gate"; }
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 <<'SQL'
UPDATE net._http_response SET created=clock_timestamp() WHERE id IN(1,2);
INSERT INTO public.clubs VALUES('11111111-1111-4111-8111-111111111111');
INSERT INTO public.process_swing_dispatch_runs(run_id,request_id,club_id,tick_at,request_fingerprint,net_request_id,requested_at,lease_token,lease_expires_at,business_state)
SELECT gen_random_uuid(),gen_random_uuid(),'11111111-1111-4111-8111-111111111111',now(),'lock-'||n,n,clock_timestamp(),gen_random_uuid(),now()+interval '1 minute','started' FROM generate_series(1,2)n;
SQL
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT run_id FROM public.process_swing_dispatch_runs WHERE request_fingerprint='lock-1' FOR UPDATE;
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100};do [[ -f "$gate/ready" ]] && break;sleep 0.05;done
test -f "$gate/ready"
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout='10s';
DO $$DECLARE r jsonb;BEGIN r:=public.observe_process_swing_cron(100);IF(r->>'observed')::integer<>1 THEN RAISE EXCEPTION 'skip locked failed';END IF;END$$;
SQL
touch "$gate/release";wait "$holder";holder=''
PGUSER=postgres psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$DECLARE r jsonb;BEGIN r:=public.observe_process_swing_cron(100);IF(r->>'observed')::integer<>1 THEN RAISE EXCEPTION 'unlocked row not resumed';END IF;
r:=public.observe_process_swing_cron(100);IF(r->>'observed')::integer<>0 THEN RAISE EXCEPTION 'terminal transport observed twice';END IF;
IF EXISTS(SELECT 1 FROM public.process_swing_dispatch_runs WHERE business_state<>'started' OR transport_state<>'succeeded') THEN RAISE EXCEPTION 'business or transport invariant';END IF;END$$;
SQL
for denied_role in anon authenticated;do
 psql -X -v ON_ERROR_STOP=1 <<SQL
SET ROLE $denied_role;
DO \$\$BEGIN BEGIN PERFORM public.observe_process_swing_cron(100);RAISE EXCEPTION 'untrusted caller allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END\$\$;
SQL
done
echo OBSERVER_SKIP_LOCKED_RESUME_DUPLICATE_AND_ACTOR_PASS
