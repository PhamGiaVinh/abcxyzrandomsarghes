-- CLI candidate 20261018113750; forward slot142. LOCAL ONLY, not live.
-- Selection fairness only, NOT a settlement lease. Payment RPC retains its
-- existing locks/idempotency. A crash after selection delays, never loses a row.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.sepay_settlement_attempts (
 bank_transaction_id uuid PRIMARY KEY REFERENCES public.bank_transactions(id),
 last_attempt_at timestamptz NOT NULL
);
ALTER TABLE private.sepay_settlement_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.sepay_settlement_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sepay_take_settlement_batch_v1(p_club_id uuid,p_limit integer DEFAULT 500)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account text; stamp timestamptz;
BEGIN
 IF coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role'
   OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 IF p_club_id IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
   RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE='22023'; END IF;
 -- Serialize selection by account (not club): aliases must share fairness.
 SELECT c.master_account_number INTO account FROM public.club_payment_config c
 WHERE c.club_id=p_club_id AND c.is_active AND c.api_token_vault_key IS NOT NULL;
 IF account IS NULL OR btrim(account)='' THEN RAISE EXCEPTION 'active_payment_account_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sepay-fair-batch:'||account,0));
 stamp:=clock_timestamp();
 RETURN QUERY
 WITH chosen AS MATERIALIZED (
  SELECT b.id FROM public.bank_transactions b
  LEFT JOIN private.sepay_settlement_attempts a ON a.bank_transaction_id=b.id
  WHERE b.provider='sepay' AND b.account_number=account AND b.status='unmatched'
   AND b.transfer_type='in' AND b.api_verified_at IS NOT NULL
  ORDER BY a.last_attempt_at ASC NULLS FIRST,b.id LIMIT p_limit
  FOR UPDATE OF b SKIP LOCKED
 ), marked AS (
  INSERT INTO private.sepay_settlement_attempts AS attempts(bank_transaction_id,last_attempt_at)
  SELECT chosen.id,stamp FROM chosen
  ON CONFLICT(bank_transaction_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at
  RETURNING bank_transaction_id
 ) SELECT marked.bank_transaction_id FROM marked ORDER BY marked.bank_transaction_id;
END $$;
REVOKE ALL ON FUNCTION public.sepay_take_settlement_batch_v1(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sepay_take_settlement_batch_v1(uuid,integer) TO service_role;
COMMIT;
