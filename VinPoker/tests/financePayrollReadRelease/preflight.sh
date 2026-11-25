#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_pt_read_release
source_db="$PGDATABASE"
case_db=vinpoker_ops_pt_read_release_preflight
out="${1:?runner-local evidence directory}"
mkdir -p "$out"
cleanup(){ dropdb --if-exists "$case_db" >/dev/null; }
trap cleanup EXIT
for fault in clean rollback_drift source definer acl collision; do
  createdb --template="$source_db" "$case_db"
  export PGDATABASE="$case_db"
  case "$fault" in
    clean|rollback_drift) setup='SELECT 1;' ;;
    source) setup="DO \$test\$ DECLARE p pg_proc%rowtype; BEGIN
      SELECT * INTO p FROM pg_proc WHERE oid='public.get_dealer_payroll_statement(uuid)'::regprocedure;
      EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,p.prosrc||E'\n-- TEST drift'); END \$test\$;" ;;
    definer) setup='ALTER FUNCTION public.get_dealer_payroll_statement(uuid) SECURITY INVOKER;' ;;
    acl) setup='GRANT EXECUTE ON FUNCTION public.get_dealer_payroll_statement(uuid) TO anon;' ;;
    collision) setup="CREATE FUNCTION public.get_pt_statement_installments_v1(integer) RETURNS jsonb LANGUAGE sql AS 'SELECT null::jsonb';" ;;
  esac
  psql -Xq -v ON_ERROR_STOP=1 -c "$setup"
  before="$(psql -XqAt -v ON_ERROR_STOP=1 -f tests/financePayrollReadRelease/catalog-fingerprint.sql)"
  status=0
  psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_statement_reads_v1.sql > "$out/$fault.out" 2> "$out/$fault.err" || status=$?
  if test "$fault" = clean || test "$fault" = rollback_drift; then
    if test "$status" != 0; then cat "$out/$fault.err"; exit 1; fi
    test "$(psql -XqAt -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')")" = 2
    if test "$fault" = rollback_drift; then
      psql -Xq -v ON_ERROR_STOP=1 -c 'ALTER FUNCTION public.get_pt_statement_installments_v1(uuid) SECURITY INVOKER;'
      own_before="$(psql -XqAt -c "SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')")"
      rollback_status=0
      psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_statement_reads_v1.rollback.sql > "$out/rollback.out" 2> "$out/rollback.err" || rollback_status=$?
      test "$rollback_status" != 0
      grep -q PT_STATEMENT_READS_ROLLBACK_DRIFT "$out/rollback.err"
      test "$(psql -XqAt -c "SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')")" = "$own_before"
    else
      psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_statement_reads_v1.rollback.sql
      test "$(psql -XqAt -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')")" = 0
    fi
  else
    test "$status" != 0
    if test "$fault" = collision; then
      grep -q PT_STATEMENT_READS_TARGET_COLLISION "$out/$fault.err"
      test "$(psql -XqAt -c "SELECT to_regprocedure('public.get_pt_statement_installments_v1(integer)') IS NOT NULL")" = t
    else grep -q PT_STATEMENT_READS_AUTHORIZE_DRIFT "$out/$fault.err"; fi
    test "$(psql -XqAt -c "SELECT to_regprocedure('public.get_pt_statement_installments_v1(uuid)') IS NULL AND to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') IS NULL")" = t
  fi
  test "$(psql -XqAt -v ON_ERROR_STOP=1 -f tests/financePayrollReadRelease/catalog-fingerprint.sql)" = "$before"
  export PGDATABASE="$source_db"
  cleanup
  echo "PT_READ_STANDALONE_${fault}_EXPECTED_ATOMIC_RESULT_PASS"
done
