-- Existing owned L02 fixture has committed its bank payment before this check.
-- Read/replay only: preserves the original paid obligation and all payment fields.
BEGIN;
DO $test$
DECLARE
  obligation constant uuid := '16680000-0000-4000-8000-000000000031';
  actor constant uuid := '16680000-0000-4000-8000-000000000002';
  before_row jsonb;
  result jsonb;
BEGIN
  ASSERT current_database() = 'vinpoker_ops_l02';
  SELECT to_jsonb(r) INTO before_row FROM public.staff_salary_runs r WHERE id=obligation;
  ASSERT before_row->>'status'='paid' AND before_row->>'payment_method'='bank_transfer';
  ASSERT (before_row->>'net_vnd')::bigint=5000000;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  SET LOCAL ROLE authenticated;
  result:=public.mark_staff_salary_paid(obligation,'cash',NULL);
  ASSERT result->>'error'='PAYMENT_INTENT_CONFLICT', 'different method must be reported: '||result::text;
  result:=public.mark_staff_salary_paid(obligation,'bank_transfer','DIFFERENT-REFERENCE');
  ASSERT result->>'error'='PAYMENT_INTENT_CONFLICT', 'different reference must be reported: '||result::text;
  result:=public.mark_staff_salary_paid(obligation,'bank_transfer',' TEST-L02-TRANSFER ');
  ASSERT result->>'status'='paid' AND result->>'idempotent'='true', result::text;
  ASSERT result->>'payment_method'='bank_transfer' AND result->>'payment_reference'='TEST-L02-TRANSFER';
  ASSERT result->>'paid_at'=before_row->>'paid_at';
  RESET ROLE;
  ASSERT (SELECT to_jsonb(r) FROM public.staff_salary_runs r WHERE id=obligation)=before_row,
    'retries must preserve the complete paid obligation';
END
$test$;
ROLLBACK;
