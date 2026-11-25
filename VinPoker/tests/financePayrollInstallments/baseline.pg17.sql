\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'vinpoker_ops_pt_installment' THEN RAISE EXCEPTION 'isolated_database_required'; END IF;
  IF EXISTS(SELECT FROM public.clubs) OR EXISTS(SELECT FROM public.dealer_pt_wage_payments) THEN
    RAISE EXCEPTION 'empty_schema_restore_required';
  END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('18000000-0000-4000-8000-000000000011');
INSERT INTO public.profiles(user_id,display_name) VALUES ('18000000-0000-4000-8000-000000000011','PT installment TEST owner');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
 ('18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000011','PT installment TEST','TEST','approved');
SET LOCAL request.jwt.claim.sub='18000000-0000-4000-8000-000000000011';
INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,hourly_rate_vnd) VALUES
 ('18000000-0000-4000-8000-000000000051','18000000-0000-4000-8000-000000000001','PT installment TEST dealer','active','part_time',50000);
INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by) VALUES
 ('18000000-0000-4000-8000-000000000051',50000,true,'2026-11-01T00:00:00+07:00','18000000-0000-4000-8000-000000000011');
INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
SELECT '18000000-0000-4000-8000-000000000051',day::date,'checked_out','checked_out',
 day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);
SET LOCAL ROLE authenticated;
DO $proof$
DECLARE before_payment jsonb; after_payment jsonb; finalized jsonb; v_statement_id uuid;
BEGIN
  before_payment := public.get_club_pt_wages('18000000-0000-4000-8000-000000000001')->'dealers'->0;
  IF before_payment->>'balance_vnd' IS DISTINCT FROM '5000000'
    OR before_payment->>'accrued_minutes' IS DISTINCT FROM '6000'
  THEN RAISE EXCEPTION 'fixture_five_million_earnings_wrong'; END IF;
  finalized := public.finalize_part_time_payroll_statement('18000000-0000-4000-8000-000000000091',
    '18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000051','TEST immutable 5M');
  v_statement_id := (finalized->>'statement_id')::uuid;
  IF v_statement_id IS NULL OR finalized->>'net_amount_vnd' IS DISTINCT FROM '5000000'
  THEN RAISE EXCEPTION 'fixture_statement_not_finalized'; END IF;
  after_payment := public.get_club_pt_wages('18000000-0000-4000-8000-000000000001')->'dealers'->0;
  IF after_payment->>'balance_vnd' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'finalized_interval_not_reserved'; END IF;
  PERFORM set_config('test.pt_statement_id',v_statement_id::text,true);
END
$proof$;
RESET ROLE;
-- Observe storage as the isolated fixture owner; do not widen application grants.
CREATE TEMP TABLE pt_statement_before AS
SELECT to_jsonb(s) AS snapshot FROM public.dealer_payroll_statements s
WHERE id=current_setting('test.pt_statement_id')::uuid;
SET LOCAL ROLE authenticated;
DO $payment$
DECLARE payment jsonb; replay jsonb; v_statement_id uuid:=current_setting('test.pt_statement_id')::uuid;
BEGIN
  payment := public.pay_finalized_part_time_payroll_statement(v_statement_id,'bank','TEST FULL PAYMENT','pt-installment-baseline-full','TEST existing full-only API');
  replay := public.pay_finalized_part_time_payroll_statement(v_statement_id,'bank','TEST FULL PAYMENT','pt-installment-baseline-full','TEST existing full-only API');
  IF payment->>'amount_vnd' IS DISTINCT FROM '5000000' OR payment->>'idempotent' IS DISTINCT FROM 'false'
    OR replay->>'payment_id' IS DISTINCT FROM payment->>'payment_id' OR replay->>'idempotent' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'existing_full_payment_behavior_changed'; END IF;
END
$payment$;
RESET ROLE;
DO $storage$
DECLARE v_statement_id uuid:=current_setting('test.pt_statement_id')::uuid;
  original_statement jsonb;
BEGIN
  SELECT snapshot INTO STRICT original_statement FROM pt_statement_before;
  IF (SELECT count(*) FROM public.dealer_pt_wage_payments WHERE dealer_id='18000000-0000-4000-8000-000000000051') <> 1
    OR (SELECT sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE dealer_id='18000000-0000-4000-8000-000000000051') <> 5000000
  THEN RAISE EXCEPTION 'existing_full_payment_ledger_wrong'; END IF;
  IF NOT EXISTS(SELECT FROM public.dealer_pt_wage_settlements WHERE statement_id=v_statement_id AND status='paid') THEN
    RAISE EXCEPTION 'existing_full_payment_not_settled';
  END IF;
  IF NOT EXISTS(SELECT FROM public.dealer_payroll_statements s WHERE s.id=v_statement_id
    AND s.pt_wage_payment_id IS NOT NULL
    AND (to_jsonb(s)-'pt_wage_payment_id')=(original_statement-'pt_wage_payment_id')) THEN
    RAISE EXCEPTION 'original_statement_was_rewritten';
  END IF;
END
$storage$;
ROLLBACK;
SELECT 'CURRENT_PT_FULL_ONLY_5M_SNAPSHOT_RESERVED_SINGLE_PAYMENT_PASS_NOT_INSTALLMENT_QUALIFICATION' AS result;
