-- Owner-gated forward rollback. Keeps the audit backup and all hand history.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
  IF current_user<>'postgres' OR current_setting('vinpoker.free_test_repair_ack',true)
    IS DISTINCT FROM 'PREPARE_FREE_FELT_2_REGISTRATIONS_20261124' THEN
    RAISE EXCEPTION 'free_felt_repair_ack_required';
  END IF;
END $$;
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
  IF (SELECT count(*) FROM floor_private.free_felt_finance_20261124_backup WHERE rolled_back_at IS NULL)<>2
    OR EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup
      WHERE history_fingerprint IS DISTINCT FROM (SELECT fingerprint FROM free_felt_history_fingerprint))
    OR EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup b
      LEFT JOIN public.tournament_registrations r ON r.id=b.registration_id
      WHERE to_jsonb(r) IS DISTINCT FROM b.after_row) THEN
    RAISE EXCEPTION 'free_felt_rollback_drift';
  END IF;
  IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=m.registration_id)
    OR EXISTS(SELECT 1 FROM public.cashier_refund_requests f
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=f.registration_id)
    OR EXISTS(SELECT 1 FROM public.payment_settlements s
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=s.tournament_registration_id)
    OR EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers s
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=s.registration_id) THEN
    RAISE EXCEPTION 'free_felt_rollback_money_evidence';
  END IF;
END $$;
UPDATE public.tournament_registrations r SET buy_in=(b.before_row->>'buy_in')::bigint
FROM floor_private.free_felt_finance_20261124_backup b WHERE r.id=b.registration_id;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=m.registration_id)
    OR EXISTS(SELECT 1 FROM public.cashier_refund_requests f
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=f.registration_id)
    OR EXISTS(SELECT 1 FROM public.payment_settlements s
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=s.tournament_registration_id)
    OR EXISTS(SELECT 1 FROM public.satellite_ticket_value_transfers s
      JOIN floor_private.free_felt_finance_20261124_backup b ON b.registration_id=s.registration_id) THEN
    RAISE EXCEPTION 'free_felt_rollback_post_update_money_evidence';
  END IF;
  IF EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup b
      JOIN public.tournament_registrations r ON r.id=b.registration_id
      WHERE to_jsonb(r)-'updated_at' IS DISTINCT FROM b.before_row-'updated_at') THEN
    RAISE EXCEPTION 'free_felt_rollback_postcheck';
  END IF;
  IF EXISTS(SELECT 1 FROM floor_private.free_felt_finance_20261124_backup
      WHERE history_fingerprint IS DISTINCT FROM (SELECT fingerprint FROM free_felt_history_fingerprint)) THEN
    RAISE EXCEPTION 'free_felt_rollback_history_changed';
  END IF;
END $$;
UPDATE floor_private.free_felt_finance_20261124_backup SET rolled_back_at=clock_timestamp();
DROP VIEW free_felt_history_fingerprint;
COMMIT;
