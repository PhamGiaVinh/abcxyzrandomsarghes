\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION public.assert_pt_fixture(result jsonb) RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF result->>'club_id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'
    OR jsonb_typeof(result->'dealers') IS DISTINCT FROM 'array'
    OR jsonb_array_length(result->'dealers') IS DISTINCT FROM 1
    OR result->'dealers'->0->>'dealer_id' IS DISTINCT FROM '00000000-0000-0000-0000-000000000051'
    OR result->'dealers'->0->>'full_name' IS DISTINCT FROM 'TEST A'
    OR result->'dealers'->0->>'balance_vnd' IS DISTINCT FROM '12345'
    THEN RAISE EXCEPTION 'accountant_projection_wrong'; END IF;
END
$assert$;
DO $$ BEGIN
  IF current_database() <> 'finance_payroll_test' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_club_pt_wages(uuid)'::regprocedure)) <> '506820f7f553dc2a2c085cec3400d2d5'
    THEN RAISE EXCEPTION 'legacy_body_changed'; END IF;
  IF has_function_privilege('anon','public.get_finance_dealer_pt_wages_v1(uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'anonymous_execute_granted'; END IF;
  IF NOT has_function_privilege('authenticated','public.get_finance_dealer_pt_wages_v1(uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'authenticated_execute_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.get_finance_dealer_pt_wages_v1(uuid)'::regprocedure
    AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""'])
    THEN RAISE EXCEPTION 'reader_security_metadata_wrong'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000033';
DO $$ DECLARE result jsonb; BEGIN
  result := public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000001');
  PERFORM public.assert_pt_fixture(result);
  BEGIN
    PERFORM public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'other_club_visible';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $missing_field$
DECLARE original_calculator text; caught_message text;
BEGIN
  original_calculator := pg_get_functiondef('public._pt_wage_balance(uuid)'::regprocedure);
  EXECUTE $broken$CREATE OR REPLACE FUNCTION public._pt_wage_balance(dealer uuid) RETURNS jsonb LANGUAGE sql STABLE AS
    'SELECT jsonb_build_object(''dealer_id'', id, ''full_name'', full_name) FROM public.dealers WHERE id=dealer'$broken$;
  BEGIN
    PERFORM public.assert_pt_fixture(public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000001'));
    RAISE EXCEPTION 'missing_balance_assertion_not_rejected';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS caught_message = MESSAGE_TEXT;
    IF caught_message IS DISTINCT FROM 'accountant_projection_wrong' THEN RAISE; END IF;
  END;
  EXECUTE original_calculator;
END
$missing_field$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
DO $$ BEGIN
  IF public.get_club_pt_wages('00000000-0000-0000-0000-000000000001') IS DISTINCT FROM
     public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000001')
    THEN RAISE EXCEPTION 'owner_projection_changed'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000044';
DO $$ BEGIN
  IF public.get_club_pt_wages('00000000-0000-0000-0000-000000000002') IS DISTINCT FROM
     public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000002')
    THEN RAISE EXCEPTION 'cashier_projection_changed'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.club_accountants WHERE user_id='00000000-0000-0000-0000-000000000033';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000033';
DO $$ BEGIN
  BEGIN
    PERFORM public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'revoked_accountant_visible';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claim.sub = '';
DO $$ BEGIN
  BEGIN
    PERFORM public.get_finance_dealer_pt_wages_v1('00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'missing_actor_visible';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
-- Roll back only the new endpoint on the disposable database and verify original data/source survived.
DROP FUNCTION public.get_finance_dealer_pt_wages_v1(uuid);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.club_accountants) <> 1 OR (SELECT count(*) FROM public.dealers) <> 2
    OR (SELECT count(*) FROM public.dealer_pt_wage_payments) <> 0 THEN RAISE EXCEPTION 'fixture_data_changed'; END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_club_pt_wages(uuid)'::regprocedure)) <> '506820f7f553dc2a2c085cec3400d2d5'
    THEN RAISE EXCEPTION 'rollback_legacy_changed'; END IF;
END $$;
SELECT 'ACCOUNTANT_SCOPE_PARITY_REVOCATION_ROLLBACK_PASS' AS result;
