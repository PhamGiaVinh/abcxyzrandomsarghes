\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'vinpoker_ops_pt_installment' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES('18000000-0000-4000-8000-000000000901');
UPDATE public.dealers SET user_id='18000000-0000-4000-8000-000000000901'
WHERE id='18000000-0000-4000-8000-000000000051';
-- Pagination-only clones, not claimed to be independent finalized earnings.
-- The newest real 5M statement and actual payments remain untouched.
INSERT INTO public.dealer_payroll_statements
SELECT (jsonb_populate_record(NULL::public.dealer_payroll_statements,to_jsonb(s)||jsonb_build_object(
  'id',('18000000-0000-4000-8000-'||lpad((1000+i)::text,12,'0'))::uuid,
  'request_id',('18000000-0000-4000-8000-'||lpad((2000+i)::text,12,'0'))::uuid,
  'pt_wage_payment_id',NULL,'finalized_at','2026-11-01T00:00:00.123456Z'))).*
FROM public.dealer_payroll_statements s CROSS JOIN generate_series(1,23) i
WHERE s.dealer_id='18000000-0000-4000-8000-000000000051';
CREATE TEMP TABLE recipient_before AS SELECT jsonb_build_object(
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
  'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
  'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
  'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY statement_id) FROM public.finance_pt_installment_plans_v1 p)) fingerprint;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000901';
DO $$ DECLARE p jsonb; q jsonb; c jsonb; ids bigint; BEGIN
  p:=public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051');
  IF jsonb_array_length(p->'items') IS DISTINCT FROM 20 OR p#>>'{items,0,net_amount_vnd}' IS DISTINCT FROM '5000000'
    OR p#>>'{items,0,paid_total_vnd}' IS DISTINCT FROM '5000000' OR p#>>'{items,0,remaining_vnd}' IS DISTINCT FROM '0'
    OR p#>>'{next_cursor,statement_id}' IS DISTINCT FROM '18000000-0000-4000-8000-000000001005' THEN
    RAISE EXCEPTION 'recipient_first_page_or_paid_totals_invalid'; END IF;
  c:=p->'next_cursor';
  q:=public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051',
    (c->>'finalized_at')::timestamptz,(c->>'statement_id')::uuid);
  SELECT count(DISTINCT e->>'statement_id') INTO ids FROM jsonb_array_elements((p->'items')||(q->'items')) e;
  IF jsonb_array_length(q->'items') IS DISTINCT FROM 4 OR q->'next_cursor' IS DISTINCT FROM 'null'::jsonb OR ids IS DISTINCT FROM 24 THEN
    RAISE EXCEPTION 'recipient_pagination_omitted_or_repeated_rows'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(q->'items') e WHERE e->>'remaining_vnd' IS DISTINCT FROM '5000000') THEN
    RAISE EXCEPTION 'recipient_unpaid_clone_inferred_paid_from_another_statement'; END IF;
  BEGIN
    PERFORM public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000051');
    RAISE EXCEPTION 'recipient_wrong_club_accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  BEGIN
    PERFORM public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051',now(),NULL);
    RAISE EXCEPTION 'recipient_half_cursor_accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051',now(),
      '18000000-0000-4000-8000-000000009999');
    RAISE EXCEPTION 'recipient_fabricated_cursor_accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF has_table_privilege('authenticated','public.dealer_payroll_statements','SELECT') THEN
    RAISE EXCEPTION 'recipient_table_read_grant_widened'; END IF;
END $$;
-- Owner and cashier must use their existing operator seam, never impersonate self.
DO $$ DECLARE actor text; BEGIN
  FOREACH actor IN ARRAY ARRAY['18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000012',''] LOOP
    PERFORM set_config('request.jwt.claim.sub',actor,true);
    BEGIN
      PERFORM public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051');
      RAISE EXCEPTION 'recipient_unauthorized_actor_accepted';
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
UPDATE public.dealers SET user_id=NULL WHERE id='18000000-0000-4000-8000-000000000051';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000901';
DO $$ BEGIN
  BEGIN
    PERFORM public.list_my_pt_statements_v1('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051');
    RAISE EXCEPTION 'recipient_revoked_link_kept_read';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE after_reads jsonb; BEGIN
  SELECT jsonb_build_object(
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
    'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
    'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
    'plans',(SELECT jsonb_agg(to_jsonb(p) ORDER BY statement_id) FROM public.finance_pt_installment_plans_v1 p)) INTO after_reads;
  IF after_reads IS DISTINCT FROM (SELECT fingerprint FROM recipient_before) THEN
    RAISE EXCEPTION 'recipient_reads_changed_financial_facts'; END IF;
  IF has_function_privilege('anon','public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'recipient_function_privileges_widened'; END IF;
END $$;
ROLLBACK;
SELECT 'PT_RECIPIENT_SELF_SCOPE_KEYSET_PAGINATION_NO_FINANCIAL_MUTATION_PASS' result;
