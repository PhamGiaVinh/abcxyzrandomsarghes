\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database()<>'vinpoker_ops_pt_read_release' THEN RAISE EXCEPTION 'isolated_database_required';END IF;END $$;
CREATE TEMP TABLE auth_before AS SELECT jsonb_build_object(
 'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
 'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
 'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s)) fingerprint;
SELECT set_config('test.read_statement',(SELECT id::text FROM public.dealer_payroll_statements WHERE dealer_id='18000000-0000-4000-8000-000000000051'),true);
DELETE FROM public.club_accountants WHERE club_id='18000000-0000-4000-8000-000000000001' AND user_id='18000000-0000-4000-8000-000000000014';
-- Preserve the real one-club-per-owner invariant in cross-CLB test data.
INSERT INTO auth.users(id) VALUES('18000000-0000-4000-8000-000000000015');
INSERT INTO public.profiles(user_id,display_name) VALUES('18000000-0000-4000-8000-000000000015','Other TEST club owner');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000015','Other TEST club','TEST','approved');
INSERT INTO public.club_accountants(club_id,user_id) VALUES('18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000014');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000014';
DO $$ BEGIN
 BEGIN
  PERFORM public.get_pt_statement_installments_v1(current_setting('test.read_statement')::uuid);
  RAISE EXCEPTION 'revoked_accountant_kept_other_club_detail';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
 BEGIN
  PERFORM public.pay_finalized_part_time_payroll_statement(current_setting('test.read_statement')::uuid,'bank',NULL,'TEST unauthorized',NULL);
  RAISE EXCEPTION 'read_role_received_payment_permission';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;
END $$;
RESET ROLE;
DO $$ DECLARE p regprocedure; after_auth jsonb; BEGIN
 FOREACH p IN ARRAY ARRAY['public.get_pt_statement_installments_v1(uuid)'::regprocedure,'public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)'::regprocedure] LOOP
  IF has_function_privilege('anon',p,'EXECUTE') OR has_function_privilege('service_role',p,'EXECUTE')
    OR NOT has_function_privilege('authenticated',p,'EXECUTE') THEN RAISE EXCEPTION 'read_release_acl_wrong';END IF;
 END LOOP;
 IF has_table_privilege('authenticated','public.dealer_payroll_statements','SELECT') THEN RAISE EXCEPTION 'private_table_grant_widened';END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_index i WHERE i.indexrelid='public.dealer_pt_wage_payments_statement_uq'::regclass AND i.indisunique) THEN
  RAISE EXCEPTION 'legacy_full_only_index_changed';END IF;
 IF to_regclass('public.finance_pt_installment_plans_v1') IS NOT NULL THEN RAISE EXCEPTION 'money_foundation_unexpected';END IF;
 SELECT jsonb_build_object(
  'payments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_pt_wage_payments x),
  'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_payroll_statements s),
  'settlements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s)) INTO after_auth;
 IF after_auth IS DISTINCT FROM (SELECT fingerprint FROM auth_before) THEN RAISE EXCEPTION 'read_authorization_changed_finance';END IF;
END $$;
ROLLBACK;
SELECT 'PT_READ_STANDALONE_EXACT_ACCOUNTANT_REVOCATION_ACL_LEGACY_INDEX_PRESERVED_PASS' result;
