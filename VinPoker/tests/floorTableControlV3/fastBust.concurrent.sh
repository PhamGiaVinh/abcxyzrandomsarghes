#!/usr/bin/env bash
set -euo pipefail
# Real independent PG connections, browser role inside the test-only invoker.
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
run() {
 psql -X -v ON_ERROR_STOP=1 -Atq <<SQL
SET statement_timeout='10s';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
BEGIN;
SELECT fast_bust_test.invoke((SELECT context FROM fast_bust_test.cases WHERE name='$1'),'$2');
SELECT pg_sleep(0.4);
COMMIT;
SQL
}
run first 11111111-0000-0000-0000-000000000001 >"$out/first" & first=$!
run second 11111111-0000-0000-0000-000000000002 >"$out/second" & second=$!
wait "$first"; wait "$second"
grep -q '"outcome": "busted"' "$out/first"
grep -q '"outcome": "busted"' "$out/second"
run double 11111111-0000-0000-0000-000000000003 >"$out/duplicate1" & first=$!
run double 11111111-0000-0000-0000-000000000003 >"$out/duplicate2" & second=$!
wait "$first"; wait "$second"
grep -q '"outcome": "busted"' "$out/duplicate1"
grep -q '"outcome": "busted"' "$out/duplicate2"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT public.floor_table_v3_assert((SELECT count(*)=3 FROM public.table_operation_receipts
 WHERE operation_type='floor_operator_bust_seat_v1' AND request_id IN
 ('11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000003')),
 'two distinct busts + one effective duplicate receipt');
SELECT public.floor_table_v3_assert((SELECT count(*)=3 FROM fast_bust_test.cases c
 JOIN public.tournament_entries e ON e.id=(c.context->>'entry')::uuid
 WHERE c.name IN ('first','second','double') AND e.status='busted'), 'all concurrent intended entries busted');
SELECT 'FLOOR_FAST_BUST_CONCURRENCY_PASS';
SQL
