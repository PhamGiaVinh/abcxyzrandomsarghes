#!/usr/bin/env bash
set -euo pipefail
# Catches replacing an unrelated/weakened legacy uniqueness index before the
# extension changes any objects. Each fault uses a disposable empty DB clone.
test "${PGHOST:?}" = 127.0.0.1
test "${PGDATABASE:?}" = vinpoker_ops_pt_installment
out="${1:?runner-local output directory}"
mkdir -p "$out"
source_db="$PGDATABASE"
case_db=vinpoker_ops_pt_preflight
cleanup() { dropdb --if-exists "$case_db" >/dev/null; }
trap cleanup EXIT
for fault in decoy nonunique wrong_column wrong_predicate missing; do
  createdb --template="$source_db" "$case_db"
  export PGDATABASE="$case_db"
  psql -Xq -v ON_ERROR_STOP=1 -c 'ALTER INDEX public.dealer_pt_wage_payments_statement_uq RENAME TO test_original_statement_uq;'
  case "$fault" in
    decoy) setup='CREATE TABLE public.test_unrelated(statement_id uuid); CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq ON public.test_unrelated(statement_id) WHERE statement_id IS NOT NULL;' ;;
    nonunique) setup='CREATE INDEX dealer_pt_wage_payments_statement_uq ON public.dealer_pt_wage_payments(statement_id) WHERE statement_id IS NOT NULL;' ;;
    wrong_column) setup='CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq ON public.dealer_pt_wage_payments(id) WHERE statement_id IS NOT NULL;' ;;
    wrong_predicate) setup='CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq ON public.dealer_pt_wage_payments(statement_id) WHERE statement_id IS NOT NULL AND voided_at IS NULL;' ;;
    missing) setup='SELECT 1;' ;;
  esac
  psql -Xq -v ON_ERROR_STOP=1 -c "$setup" > "$out/$fault.setup"
  before="$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT coalesce(pg_get_indexdef(to_regclass('public.dealer_pt_wage_payments_statement_uq')),'MISSING')")"
  status=0
  psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_installments_v1.sql > "$out/$fault.out" 2> "$out/$fault.err" || status=$?
  if [[ "$status" = 0 ]]; then echo "PT_PREFLIGHT_UNSAFE_INDEX_ACCEPTED:$fault" >&2; exit 1; fi
  grep -q 'PT_INSTALLMENT_LEGACY_INDEX_DRIFT' "$out/$fault.err"
  after="$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT coalesce(pg_get_indexdef(to_regclass('public.dealer_pt_wage_payments_statement_uq')),'MISSING')")"
  test "$before" = "$after"
  test "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.finance_pt_installment_plans_v1') IS NULL AND NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.dealer_pt_wage_payments'::regclass AND attname='installment_request_id' AND NOT attisdropped)")" = t
  export PGDATABASE="$source_db"
  cleanup
  echo "PT_PREFLIGHT_${fault}_REFUSED_WITHOUT_MUTATION_PASS"
done
