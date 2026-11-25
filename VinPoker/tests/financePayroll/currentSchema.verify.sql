\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_finance_pt' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
END $$;
CREATE TEMP VIEW finance_pt_current_state AS
SELECT jsonb_build_object(
  'dealers', (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.dealers d),
  'attendance', (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
  'rates', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.dealer_pt_wage_rate_history r),
  'payments', (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.dealer_pt_wage_payments p),
  'settlements', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.dealer_pt_wage_settlements s),
  'earned', public._pt_wage_balance('17950000-0000-4000-8000-000000000051')
) AS snapshot;
CREATE TEMP TABLE finance_pt_before AS SELECT snapshot FROM finance_pt_current_state;
-- No product calculation/permission/RLS doubles: execute the captured calculator
-- and dependencies with the restore helper's isolated auth-context shim.
-- This qualifies this fixture, not every payroll writer or hosted Auth/HTTP.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '17950000-0000-4000-8000-000000000033';
DO $$ DECLARE result jsonb; BEGIN
  result := public.get_finance_dealer_pt_wages_v1('17950000-0000-4000-8000-000000000001');
  IF result->>'club_id' IS DISTINCT FROM '17950000-0000-4000-8000-000000000001'
    OR jsonb_typeof(result->'dealers') IS DISTINCT FROM 'array'
    OR jsonb_array_length(result->'dealers') IS DISTINCT FROM 1
    OR result->'dealers'->0->>'dealer_id' IS DISTINCT FROM '17950000-0000-4000-8000-000000000051'
    OR result->'dealers'->0->>'balance_vnd' IS DISTINCT FROM '60000'
    OR result->'dealers'->0->>'accrued_minutes' IS DISTINCT FROM '60'
    OR result->'dealers'->0->>'current_shift_open' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'captured_calculator_projection_wrong'; END IF;
  BEGIN
    PERFORM public.get_finance_dealer_pt_wages_v1('17950000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'other_club_visible';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claim.sub = '17950000-0000-4000-8000-000000000011';
DO $$ BEGIN
  IF public.get_club_pt_wages('17950000-0000-4000-8000-000000000001') IS DISTINCT FROM
     public.get_finance_dealer_pt_wages_v1('17950000-0000-4000-8000-000000000001')
  THEN RAISE EXCEPTION 'captured_owner_projection_changed'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.club_accountants WHERE user_id='17950000-0000-4000-8000-000000000033';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '17950000-0000-4000-8000-000000000033';
DO $$ BEGIN
  BEGIN
    PERFORM public.get_finance_dealer_pt_wages_v1('17950000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'revoked_accountant_visible';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
-- Compare contents BEFORE rollback, so an unexpected write cannot disappear.
-- Membership deletion is intentional and checked separately below.
DO $$ BEGIN
  IF (SELECT snapshot FROM finance_pt_current_state) IS DISTINCT FROM
     (SELECT snapshot FROM finance_pt_before)
  THEN RAISE EXCEPTION 'reader_mutated_fixture'; END IF;
  IF EXISTS(SELECT FROM public.club_accountants) THEN
    RAISE EXCEPTION 'revocation_fixture_not_exercised';
  END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.club_accountants) <> 1 THEN
    RAISE EXCEPTION 'membership_rollback_failed';
  END IF;
END $$;
SELECT 'CAPTURED_SCHEMA_REAL_CALCULATOR_SCOPE_REVOCATION_PASS' AS result;
