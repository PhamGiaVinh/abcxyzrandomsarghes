-- Read-only regression against the original recorded FT payment.
BEGIN;
DO $test$
DECLARE packet jsonb; receipt jsonb;
BEGIN
  ASSERT current_database()='vinpoker_ops_l02';
  PERFORM set_config('request.jwt.claim.sub','16680000-0000-4000-8000-000000000002',true);
  SET LOCAL ROLE authenticated;
  packet:=public.get_staff_salary_report('16680000-0000-4000-8000-000000000011',2026,11);
  SELECT value INTO receipt FROM jsonb_array_elements(packet->'rows')
    WHERE value->>'id'='16680000-0000-4000-8000-000000000031';
  ASSERT receipt->>'status'='paid';
  ASSERT receipt->>'payment_method'='bank_transfer',receipt::text;
  ASSERT nullif(receipt->>'payment_reference','') IS NOT NULL,receipt::text;
  ASSERT nullif(receipt->>'paid_at','') IS NOT NULL,receipt::text;
  ASSERT (receipt->>'net_vnd')::bigint=5000000;
END
$test$;
ROLLBACK;
