#!/usr/bin/env bash
set -euo pipefail
test "$PGHOST" = 127.0.0.1
test "$PGDATABASE" = vinpoker_ops_pt_installment
source_db="$PGDATABASE"
case_db=vinpoker_ops_pt_readers_preflight
out="${1:?runner-local output directory}"
mkdir -p "$out"
cleanup(){ dropdb --if-exists "$case_db" >/dev/null; }
trap cleanup EXIT
for fault in clean missing source privilege acl history_source history_defaults history_acl overload; do
 createdb --template="$source_db" "$case_db"
 export PGDATABASE="$case_db"
 case "$fault" in
  clean) setup='SELECT 1;' ;;
  missing) setup='DROP FUNCTION public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid);' ;;
  source) setup="DO \$test\$ DECLARE p pg_proc%rowtype; BEGIN SELECT * INTO p FROM pg_proc WHERE oid='public.get_pt_statement_installments_v1(uuid)'::regprocedure;
   EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,p.prosrc||E'\n-- TEST drift');END \$test\$;" ;;
  privilege) setup='ALTER FUNCTION public.get_pt_statement_installments_v1(uuid) SECURITY INVOKER;' ;;
  acl) setup='GRANT EXECUTE ON FUNCTION public.get_pt_statement_installments_v1(uuid) TO anon;' ;;
  history_source) setup="DO \$test\$ DECLARE p pg_proc%rowtype; BEGIN SELECT * INTO p FROM pg_proc WHERE oid='public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)'::regprocedure;
   EXECUTE replace(pg_get_functiondef(p.oid),p.prosrc,p.prosrc||E'\n-- TEST drift');END \$test\$;" ;;
  history_defaults) setup="DO \$test\$ DECLARE definition text; BEGIN definition:=pg_get_functiondef('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)'::regprocedure);
   IF strpos(definition,'DEFAULT NULL::uuid')=0 THEN RAISE EXCEPTION 'expected_null_default_missing';END IF;
   EXECUTE replace(definition,'DEFAULT NULL::uuid','DEFAULT ''18000000-0000-4000-8000-000000000099''::uuid');END \$test\$;" ;;
  history_acl) setup='GRANT EXECUTE ON FUNCTION public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid) TO service_role;' ;;
  overload) setup="CREATE FUNCTION public.list_my_pt_statements_v1(integer) RETURNS jsonb LANGUAGE sql AS 'SELECT null::jsonb';" ;;
 esac
 psql -Xq -v ON_ERROR_STOP=1 -c "$setup"
 reader_fingerprint="$(psql -XqAt -c "SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')")"
 index_before="$(psql -XqAt -c "SELECT pg_get_indexdef('public.dealer_pt_wage_payments_statement_uq'::regclass)")"
 status=0
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/pending-migrations/finance_pt_installments_v1.sql >"$out/$fault.out" 2>"$out/$fault.err" || status=$?
 if test "$fault" = clean; then
  if test "$status" != 0; then cat "$out/$fault.err";exit 1;fi
  test "$(psql -XqAt -c "SELECT to_regclass('public.finance_pt_installment_plans_v1') IS NOT NULL")" = t
 else
  test "$status" != 0
  grep -q PT_INSTALLMENT_RELEASED_READERS_REQUIRED "$out/$fault.err"
  test "$(psql -XqAt -c "SELECT to_regclass('public.finance_pt_installment_plans_v1') IS NULL AND NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.dealer_pt_wage_payments'::regclass AND attname='installment_request_id' AND NOT attisdropped)")" = t
  test "$(psql -XqAt -c "SELECT pg_get_indexdef('public.dealer_pt_wage_payments_statement_uq'::regclass)")" = "$index_before"
 fi
 test "$(psql -XqAt -c "SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.oid)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')")" = "$reader_fingerprint"
 export PGDATABASE="$source_db"
 cleanup
 echo "PT_READERS_${fault}_EXPECTED_DEPENDENCY_RESULT_PASS"
done
