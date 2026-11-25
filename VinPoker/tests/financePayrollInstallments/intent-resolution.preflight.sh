#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_pt_installment
source_db="$PGDATABASE"
case_db=vinpoker_ops_pt_resolution_preflight
out="${1:?runner-local output directory}"
mkdir -p "$out"
cleanup(){ dropdb --if-exists "$case_db" >/dev/null; }
trap cleanup EXIT
for fault in full_fence helper_privilege helper_acl; do
  createdb --template="$source_db" "$case_db"
  export PGDATABASE="$case_db"
  case "$fault" in
    full_fence) setup="$(cat <<'SQL'
DO $test$ DECLARE p pg_proc%rowtype; changed text; BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid='public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure;
  changed:=replace(p.prosrc,E'\n  IF EXISTS(SELECT FROM public.finance_pt_installment_plans_v1 WHERE statement_id=p_statement_id) THEN\n    RAISE EXCEPTION ''PT_INSTALLMENT_USE_INSTALLMENT_API'' USING ERRCODE=''55000'';\n  END IF;','');
  IF changed=p.prosrc THEN RAISE EXCEPTION 'test_full_payment_fence_not_removed'; END IF;
  EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,changed);
END $test$;
SQL
)" ;;
    helper_privilege) setup="ALTER FUNCTION public._lock_pt_installment_statement_v1(uuid) SECURITY INVOKER;" ;;
    helper_acl) setup="GRANT EXECUTE ON FUNCTION public._lock_pt_installment_statement_v1(uuid) TO anon;" ;;
  esac
  psql -Xq -v ON_ERROR_STOP=1 -c "$setup"
  status=0
  psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_intent_resolution_v1.sql > "$out/$fault.out" 2> "$out/$fault.err" || status=$?
  test "$status" != 0
  grep -q PT_INTENT_RESOLUTION_FOUNDATION_DRIFT "$out/$fault.err"
  test "$(psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT to_regprocedure('public.resolve_pt_full_payment_intent_v1(uuid,text,text)') IS NULL")" = t
  export PGDATABASE="$source_db"
  cleanup
  echo "PT_RESOLUTION_${fault}_DRIFT_REFUSED_PASS"
done
