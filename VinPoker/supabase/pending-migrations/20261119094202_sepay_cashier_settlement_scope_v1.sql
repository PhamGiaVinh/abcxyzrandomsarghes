-- Read-only candidate. Rollback: DROP FUNCTION public.sepay_cashier_settlement_scope_v1(uuid, uuid, text, int).

CREATE OR REPLACE FUNCTION public.sepay_cashier_settlement_scope_v1(
  p_club_id uuid,
  p_bank_transaction_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'actionable',
  p_limit int  DEFAULT 200
) RETURNS TABLE (
  bank_transaction_id   uuid,
  club_id               uuid,
  club_name             text,
  amount                bigint,
  content               text,
  txn_ref               text,
  occurred_at           timestamptz,
  created_at            timestamptz,
  bt_status             text,
  reference_code        text,
  reg_match_count       int,
  registration_id       uuid,
  reg_status            text,
  reg_total_pay         bigint,
  player_display        text,
  tournament_name       text,
  amount_delta          bigint,
  settlement_outcome    text,
  settlement_reason     text,
  settlement_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limit int  := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cashier_club_ids(v_actor) AS allowed(cid) WHERE allowed.cid = p_club_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH acct AS (   -- account_number → exactly-one active club (same rule as settle)
    -- (array_agg(DISTINCT …))[1], NOT min(): Postgres has no min/max aggregate for uuid. The HAVING
    -- below guarantees exactly one distinct active club, so the 1-element array's [1] IS that club.
    SELECT pba.account_number, (array_agg(DISTINCT pba.club_id))[1] AS club_id
    FROM public.platform_bank_accounts pba
    WHERE pba.is_active = true AND pba.club_id IS NOT NULL
    GROUP BY pba.account_number
    HAVING count(DISTINCT pba.club_id) = 1
  )
  SELECT
    bt.id,
    a.club_id,
    c.name,
    bt.amount,
    bt.content,
    bt.txn_ref,
    bt.occurred_at,
    bt.created_at,
    bt.status,
    pref.ref,
    COALESCE(m.cnt, 0)::int,
    r.id,
    r.status::text,
    r.total_pay,
    prof.display_name,
    t.name,
    CASE WHEN r.id IS NOT NULL AND bt.amount IS NOT NULL THEN bt.amount - r.total_pay ELSE NULL END,
    s.outcome,
    s.reason,
    s.created_at
  FROM public.bank_transactions bt
  JOIN acct a               ON a.account_number = bt.account_number
  JOIN public.clubs c       ON c.id = a.club_id
  CROSS JOIN LATERAL (
    SELECT public.sepay_parse_reference_code(coalesce(bt.content,'') || ' ' || coalesce(bt.txn_ref,'')) AS ref
  ) pref
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS cnt
    FROM public.tournament_registrations tr
    WHERE pref.ref IS NOT NULL AND upper(tr.reference_code) = upper(pref.ref)
      -- scope the match to THIS transfer's resolved club (mirrors manual_confirm's club_mismatch gate)
      AND (SELECT t2.club_id FROM public.tournaments t2 WHERE t2.id = tr.tournament_id) = a.club_id
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT tr.id, tr.status, tr.total_pay, tr.tournament_id, tr.player_id
    FROM public.tournament_registrations tr
    WHERE pref.ref IS NOT NULL AND upper(tr.reference_code) = upper(pref.ref)
      -- same club scope as the count above — never attach a reg from another club
      AND (SELECT t2.club_id FROM public.tournaments t2 WHERE t2.id = tr.tournament_id) = a.club_id
    LIMIT 1
  ) r ON (m.cnt = 1)        -- only attach the registration when EXACTLY one matches (within this club)
  LEFT JOIN public.tournaments t  ON t.id = r.tournament_id
  LEFT JOIN public.profiles prof  ON prof.user_id = r.player_id
  LEFT JOIN LATERAL (
    SELECT ps.outcome, ps.reason, ps.created_at
    FROM public.payment_settlements ps
    WHERE ps.bank_transaction_id = bt.id
    ORDER BY ps.created_at DESC
    LIMIT 1
  ) s ON true
  WHERE bt.provider = 'sepay'
    AND bt.transfer_type = 'in'
    AND bt.api_verified_at IS NOT NULL
    AND a.club_id = p_club_id
    AND (bt.club_id IS NULL OR bt.club_id = p_club_id)
    AND (
      (p_bank_transaction_id IS NOT NULL AND bt.id = p_bank_transaction_id AND bt.status IN ('unmatched', 'matched', 'ignored'))
      OR (p_bank_transaction_id IS NULL AND ((p_scope = 'actionable' AND bt.status = 'unmatched') OR (p_scope = 'resolved' AND bt.status IN ('matched', 'ignored'))))
    )
  ORDER BY bt.occurred_at DESC NULLS LAST, bt.created_at DESC, bt.id
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.sepay_cashier_settlement_scope_v1(uuid, uuid, text, int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sepay_cashier_settlement_scope_v1(uuid, uuid, text, int) TO authenticated;
