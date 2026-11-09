#!/usr/bin/env bash
# Disposable database only. SQL setup/cleanup is confined to the test database.
set -euo pipefail
gate="$(mktemp -d)"
holder=''
cleanup() {
  touch "$gate/release"
  if [[ -n "$holder" ]]; then wait "$holder" || true; fi
  rm -rf "$gate"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.clubs(id,name) VALUES('e1000000-0000-4000-8000-000000000001','CONCURRENCY TEST');
INSERT INTO public.dealer_rotation_schedule(id,club_id,status,planned_relief_at)
 SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'e1000000-0000-4000-8000-000000000001','superseded',now()-interval '100 days'
 FROM generate_series(1,10)n;
SQL
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.dealer_rotation_schedule FOR UPDATE;
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout='3s';
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_next_dealer_rotation_schedule(10);
 IF (r->>'deleted')::int<>0 OR (r->>'inspected')::int<>10 THEN
   RAISE EXCEPTION 'locked page not bounded %',r; END IF;
END$$;
SQL
touch "$gate/release"
wait "$holder"
holder=''
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$DECLARE r jsonb; BEGIN
 r:=public.cleanup_next_dealer_rotation_schedule(10);
 IF (r->>'deleted')::int<>10 OR EXISTS(SELECT 1 FROM public.dealer_rotation_schedule) THEN
   RAISE EXCEPTION 'locked rows not revisited %',r; END IF;
END$$;
SQL
rm -f "$gate/ready" "$gate/release"
psql -X -v ON_ERROR_STOP=1 >"$gate/holder.log" 2>&1 <<SQL &
BEGIN;
SELECT pg_advisory_xact_lock(70333,1);
\! touch '$gate/ready'
\! while [ ! -f '$gate/release' ]; do sleep 0.05; done
ROLLBACK;
SQL
holder=$!
for i in {1..100}; do [[ -f "$gate/ready" ]] && break; sleep 0.05; done
test -f "$gate/ready"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$BEGIN
 IF public.cleanup_next_dealer_rotation_schedule(1)->>'outcome'<>'busy' THEN
   RAISE EXCEPTION 'concurrent worker not fenced'; END IF;
END$$;
SQL
psql -X -v ON_ERROR_STOP=1 -c "DELETE FROM public.clubs WHERE id='e1000000-0000-4000-8000-000000000001';"
echo ROTATION_CHECKPOINT_CONCURRENCY_PASS

