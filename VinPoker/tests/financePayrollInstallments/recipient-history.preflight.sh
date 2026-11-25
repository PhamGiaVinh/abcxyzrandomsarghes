#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_pt_installment
source_db="$PGDATABASE"
case_db=vinpoker_ops_pt_recipient_preflight
out="${1:?runner-local output directory}"
mkdir -p "$out"
cleanup(){ dropdb --if-exists "$case_db" >/dev/null; }
trap cleanup EXIT
for fault in clean source privilege acl; do
  createdb --template="$source_db" "$case_db"
  export PGDATABASE="$case_db"
  case "$fault" in
    clean) setup="SELECT 1;" ;;
    source) setup="COMMENT ON FUNCTION public.get_pt_statement_installments_v1(uuid) IS 'TEST';
      DO \$test\$ DECLARE p pg_proc%rowtype; BEGIN
      SELECT * INTO p FROM pg_proc WHERE oid='public.get_pt_statement_installments_v1(uuid)'::regprocedure;
      EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,p.prosrc||E'\n-- TEST drift'); END \$test\$;" ;;
    privilege) setup="ALTER FUNCTION public.get_pt_statement_installments_v1(uuid) SECURITY INVOKER;" ;;
    acl) setup="GRANT EXECUTE ON FUNCTION public.get_pt_statement_installments_v1(uuid) TO anon;" ;;
  esac
  psql -Xq -v ON_ERROR_STOP=1 -c "$setup"
  status=0
  psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_recipient_history_v1.sql > "$out/$fault.out" 2> "$out/$fault.err" || status=$?
  if test "$fault" = clean; then
    if test "$status" != 0; then cat "$out/$fault.err"; exit 1; fi
    test "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') IS NOT NULL")" = t
  else
    test "$status" != 0
    grep -q PT_RECIPIENT_HISTORY_DETAIL_DRIFT "$out/$fault.err"
    test "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') IS NULL")" = t
  fi
  export PGDATABASE="$source_db"
  cleanup
  echo "PT_RECIPIENT_${fault}_EXPECTED_GUARD_RESULT_PASS"
done
