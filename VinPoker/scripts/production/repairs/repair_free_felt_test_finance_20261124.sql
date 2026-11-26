-- PREPARATION ONLY. Exact owner-confirmed free TEST fixture, not a general backfill.
-- Separate reviewed live approval + fresh backup/isolated restore required before execution.
-- Run in one transaction as postgres, with the acknowledgment set by the operator.
-- ROLLBACK: rollback_free_felt_test_finance_20261124.sql (refuses intervening edits/payments).
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
  IF current_user<>'postgres' OR current_setting('vinpoker.free_test_repair_ack',true)
    IS DISTINCT FROM 'PREPARE_FREE_FELT_2_REGISTRATIONS_20261124' THEN
    RAISE EXCEPTION 'free_felt_repair_ack_required';
  END IF;
  IF to_regclass('floor_private.free_felt_finance_20261124_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'free_felt_already_prepared';
  END IF;
  IF current_setting('vinpoker.free_test_expected_preimage_md5',true) IS NULL THEN
    RAISE EXCEPTION 'free_felt_exact_preimage_required';
  END IF;
END $$;
-- Prevent a concurrent payment/refund or registration insert from crossing preflight.
-- NOWAIT: abort rather than queue behind live work. Lock duration is transaction bounded.
LOCK TABLE public.cashier_buyin_movements,public.cashier_refund_requests,
  public.payment_settlements,public.satellite_ticket_value_transfers,
  public.tournament_registrations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
CREATE TEMP VIEW free_felt_history_fingerprint AS
SELECT jsonb_build_object(
  'hands',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb)::text)
    FROM public.tournament_hands h WHERE h.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c'),
  'players',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)::text)
    FROM public.hand_players p JOIN public.tournament_hands h ON h.id=p.hand_id
    WHERE h.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c'),
  'actions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text)
    FROM public.hand_actions a JOIN public.tournament_hands h ON h.id=a.hand_id
    WHERE h.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c')) AS fingerprint;
DO $$ BEGIN
  PERFORM 1 FROM public.tournaments
  WHERE id='5a51bec5-4da0-4dd9-861a-cc4e7678478c'
    AND club_id='22222222-2222-2222-2222-222222222222'
    AND name='TEST — Felt UAT (compact)' AND status='live' AND start_time IS NULL
    AND created_at='2026-07-03 01:41:58.17781+07'::timestamptz FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'free_felt_tournament_drift'; END IF;
  IF (SELECT count(*) FROM public.tournament_registrations
      WHERE tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c')<>2 OR
    (SELECT count(*) FROM public.tournament_registrations
      WHERE tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c'
        AND club_id='22222222-2222-2222-2222-222222222222'
        AND id IN ('5ccba4ae-82de-4f5c-a0f0-327dd7655779','a339364c-3f70-4b70-9257-9d73cd180915')
        AND status='confirmed' AND buy_in=1000000 AND total_pay=0
        AND coalesce(platform_fixed_fee,0)=0 AND price_snapshot IS NULL
        AND cashier_paid_at IS NULL
        AND created_at IN ('2026-07-24 18:43:49.723826+07'::timestamptz,
          '2026-07-24 18:43:50.71677+07'::timestamptz))<>2 THEN
    RAISE EXCEPTION 'free_felt_registration_drift';
  END IF;
  IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb)::text)
      FROM public.tournament_registrations r
      WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c')
      IS DISTINCT FROM current_setting('vinpoker.free_test_expected_preimage_md5',true) THEN
    RAISE EXCEPTION 'free_felt_exact_preimage_drift';
  END IF;
  IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
      JOIN public.tournament_registrations r ON r.id=m.registration_id
      WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c') OR
    EXISTS(SELECT 1 FROM public.cashier_refund_requests f
      JOIN public.tournament_registrations r ON r.id=f.registration_id
      WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c') OR
    EXISTS(SELECT 1 FROM public.payment_settlements s JOIN public.tournament_registrations r
      ON r.id=s.tournament_registration_id WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c') OR
    EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers s JOIN public.tournament_registrations r
      ON r.id=s.registration_id WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c') THEN
    RAISE EXCEPTION 'free_felt_money_evidence';
  END IF;
  IF (SELECT count(*) FROM public.tournament_hands
      WHERE tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c')<>31 THEN
    RAISE EXCEPTION 'free_felt_hand_count_drift';
  END IF;
END $$;
CREATE TABLE floor_private.free_felt_finance_20261124_backup(
  registration_id uuid PRIMARY KEY,
  before_row jsonb NOT NULL,
  after_row jsonb,
  history_fingerprint jsonb NOT NULL,
  close_fingerprint text NOT NULL,
  tournament_before jsonb NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL DEFAULT 'Owner confirmed these two legacy TEST registrations were free; no revenue receipt fabricated',
  rolled_back_at timestamptz
);
ALTER TABLE floor_private.free_felt_finance_20261124_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.free_felt_finance_20261124_backup FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.free_felt_finance_20261124_backup(registration_id,before_row,history_fingerprint,close_fingerprint,tournament_before)
SELECT r.id,to_jsonb(r),(SELECT fingerprint FROM free_felt_history_fingerprint),
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.tournament_id),'[]'::jsonb)::text)
    FROM floor_private.tour_revenue_buy_close_v1 c WHERE c.tournament_id=r.tournament_id),
  (SELECT to_jsonb(t) FROM public.tournaments t WHERE t.id=r.tournament_id)
FROM public.tournament_registrations r
WHERE r.tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c';
-- Leave price_snapshot NULL: do not claim a reconstructed historical price receipt.
UPDATE public.tournament_registrations r SET buy_in=0
FROM floor_private.free_felt_finance_20261124_backup b WHERE r.id=b.registration_id;
UPDATE floor_private.free_felt_finance_20261124_backup b SET after_row=to_jsonb(r)
FROM public.tournament_registrations r WHERE r.id=b.registration_id;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup b
      WHERE b.tournament_before IS DISTINCT FROM
        (SELECT to_jsonb(t) FROM public.tournaments t WHERE t.id=(b.before_row->>'tournament_id')::uuid)
      OR b.close_fingerprint IS DISTINCT FROM
        (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.tournament_id),'[]'::jsonb)::text)
          FROM floor_private.tour_revenue_buy_close_v1 c WHERE c.tournament_id=(b.before_row->>'tournament_id')::uuid)) THEN
    RAISE EXCEPTION 'free_felt_tournament_or_close_changed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=m.registration_id)
    OR EXISTS(SELECT 1 FROM public.cashier_refund_requests f
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=f.registration_id)
    OR EXISTS(SELECT 1 FROM public.payment_settlements s
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=s.tournament_registration_id)
    OR EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers s
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=s.registration_id) THEN
    RAISE EXCEPTION 'free_felt_post_update_money_evidence';
  END IF;
  IF EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup
    WHERE after_row IS NULL OR (after_row->>'buy_in')::numeric IS DISTINCT FROM 0
      OR (after_row->>'total_pay')::numeric IS DISTINCT FROM 0
      OR before_row-ARRAY['buy_in','updated_at'] IS DISTINCT FROM after_row-ARRAY['buy_in','updated_at']) THEN
    RAISE EXCEPTION 'free_felt_unexpected_update_effect';
  END IF;
  IF (SELECT count(*) FROM public.tournament_hands
      WHERE tournament_id='5a51bec5-4da0-4dd9-861a-cc4e7678478c')<>31 OR
    EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup
      WHERE history_fingerprint IS DISTINCT FROM (SELECT fingerprint FROM free_felt_history_fingerprint)) THEN
    RAISE EXCEPTION 'free_felt_history_changed';
  END IF;
END $$;
DROP VIEW free_felt_history_fingerprint;
COMMIT;
