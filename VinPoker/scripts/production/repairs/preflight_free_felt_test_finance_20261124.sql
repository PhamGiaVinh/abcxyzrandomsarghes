-- READ ONLY. Capture exact IDs + drift fingerprint for the separately approved repair.
-- No player names, bank payloads, tokens or full registration rows are emitted.
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT r.id,r.created_at,r.buy_in,r.total_pay,r.status,r.price_snapshot IS NULL AS no_snapshot,
  r.cashier_paid_at IS NULL AS no_cashier_paid_at,coalesce(r.platform_fixed_fee,0) AS platform_fixed_fee
FROM public.tournament_registrations r
WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c' ORDER BY r.id;
SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb)::text) AS expected_preimage_md5
FROM public.tournament_registrations r
WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c';
SELECT c.relname,t.tgname,md5(pg_get_triggerdef(t.oid)) AS trigger_md5,
  t.tgenabled,md5(pg_get_functiondef(t.tgfoid)) AS function_md5
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE t.tgrelid IN ('public.tournament_registrations'::regclass,
  'public.cashier_buyin_movements'::regclass,'public.cashier_refund_requests'::regclass)
  AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
COMMIT;
