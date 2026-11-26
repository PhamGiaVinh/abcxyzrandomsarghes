\set ON_ERROR_STOP on
BEGIN;
\ir scope.seed.sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='17980000-0000-4000-8000-000000000022';
DO $$ DECLARE receipt jsonb; BEGIN
  receipt := public.record_club_expense(
    p_club_id=>'17980000-0000-4000-8000-000000000002',p_category=>'misc',
    p_amount_vnd=>100000,p_incurred_at=>'2026-11-25T10:00:00Z',
    p_description=>'TEST B original',p_idempotency_key=>'expense-baseline-b');
  IF receipt->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'fixture_expense_not_created'; END IF;
END $$;
RESET ROLE;
-- The TEST actor knows only B's opaque document ID, without B membership.
SELECT id AS other_expense FROM public.club_expenses WHERE idempotency_key='expense-baseline-b' \gset
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='17980000-0000-4000-8000-000000000033';
SELECT public.record_club_expense(
  p_club_id=>'17980000-0000-4000-8000-000000000001',p_category=>'misc',
  p_amount_vnd=>-100000,p_incurred_at=>'2026-11-25T10:00:00Z',
  p_description=>'TEST A adjustment referencing B',p_adjusts_id=>:'other_expense'::uuid,
  p_idempotency_key=>'expense-baseline-cross-club');
DO $$ DECLARE first_receipt jsonb; replay_receipt jsonb; BEGIN
  first_receipt := public.record_club_expense(
    p_club_id=>'17980000-0000-4000-8000-000000000001',p_category=>'misc',
    p_amount_vnd=>10000,p_incurred_at=>'2026-11-25T10:00:00Z',
    p_description=>'TEST first intent',p_idempotency_key=>'expense-baseline-replay');
  replay_receipt := public.record_club_expense(
    p_club_id=>'17980000-0000-4000-8000-000000000001',p_category=>'misc',
    p_amount_vnd=>20000,p_incurred_at=>'2026-11-25T10:00:00Z',
    p_description=>'TEST different intent',p_idempotency_key=>'expense-baseline-replay');
  IF first_receipt->>'status' IS DISTINCT FROM 'ok'
    OR replay_receipt->>'status' IS DISTINCT FROM 'ok'
    OR replay_receipt->>'idempotent' IS DISTINCT FROM 'true'
    OR replay_receipt->>'expense_id' IS DISTINCT FROM first_receipt->>'expense_id'
  THEN RAISE EXCEPTION 'expected_idempotency_baseline_not_reproduced'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM public.club_expenses a JOIN public.club_expenses b ON b.id=a.adjusts_id
    WHERE a.idempotency_key='expense-baseline-cross-club' AND a.club_id<>b.club_id)
  THEN RAISE EXCEPTION 'expected_cross_club_baseline_not_reproduced'; END IF;
  IF (SELECT amount_vnd FROM public.club_expenses WHERE idempotency_key='expense-baseline-replay') IS DISTINCT FROM 10000::bigint
    OR (SELECT count(*) FROM public.club_expenses WHERE idempotency_key='expense-baseline-replay') <> 1
  THEN RAISE EXCEPTION 'idempotency_baseline_state_unexpected'; END IF;
END $$;
ROLLBACK;
SELECT 'BASELINE_BUGS_REPRODUCED_CROSS_CLUB_ADJUSTMENT_AND_CONFLICTING_REPLAY_NOT_FIXED' AS result;
