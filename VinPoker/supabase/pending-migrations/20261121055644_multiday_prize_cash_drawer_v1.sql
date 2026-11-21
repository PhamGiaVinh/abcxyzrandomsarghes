-- Pending review. Roll forward to suspend new cash payouts if rollback is needed.
-- Preserve all committed prize payments and drawer movements. No backfill.
BEGIN;
SET LOCAL lock_timeout='5s';

ALTER TABLE public.cashier_buyin_movements
  ADD COLUMN prize_payment_id uuid REFERENCES public.tournament_prize_payments(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX cashier_movement_prize_payment_unique
  ON public.cashier_buyin_movements(prize_payment_id) WHERE prize_payment_id IS NOT NULL;

-- Wrap the captured legacy shape, keeping its checks on all existing movement kinds.
DO $migration$
DECLARE previous_shape text;
BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT previous_shape
  FROM pg_constraint WHERE conrelid='public.cashier_buyin_movements'::regclass
    AND conname='cashier_movement_shape' AND contype='c' AND convalidated;
  ALTER TABLE public.cashier_buyin_movements
    DROP CONSTRAINT cashier_buyin_movements_purpose_check,
    DROP CONSTRAINT cashier_movement_shape;
  ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_buyin_movements_purpose_check
    CHECK (purpose IN ('buyin','refund','drawer_adjustment','prize_payout'));
  EXECUTE format($ddl$
    ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_movement_shape
    CHECK (
      (purpose IN ('buyin','refund','drawer_adjustment') AND prize_payment_id IS NULL AND (%s))
      OR (purpose='prize_payout' AND prize_payment_id IS NOT NULL AND tournament_id IS NOT NULL
        AND method='cash' AND direction='out' AND shift_id IS NOT NULL AND registration_id IS NULL
        AND refund_id IS NULL AND bank_transaction_id IS NULL AND applied_amount=amount)
    )$ddl$,previous_shape);
END $migration$;

-- Preserve the post-finalization funding fence. Its only new accepted movement
-- is a debit derived from the verified prize payment of this transaction.
DO $migration$
DECLARE
  target regprocedure:='private.multi_day_payout_source_fence_v1()'::regprocedure;
  definition text:=replace(pg_get_functiondef(target),chr(13),'');
  anchor text:=$old$ ELSIF TG_TABLE_NAME='cashier_buyin_movements' THEN$old$;
BEGIN
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=target)
      IS DISTINCT FROM '442f372d4edb76d720a21cbcd000266d'
    OR length(definition)-length(replace(definition,anchor,''))<>length(anchor) THEN
    RAISE EXCEPTION 'cashier_prize_drawer_source_fence_drift';
  END IF;
  EXECUTE replace(definition,anchor,anchor||$new$
   IF NEW.purpose='prize_payout' AND EXISTS(
     SELECT 1 FROM public.tournament_prize_payments p
     JOIN public.cashier_till_shifts s ON s.id=NEW.shift_id AND s.club_id=p.club_id AND s.closed_at IS NULL
     WHERE p.id=NEW.prize_payment_id AND p.club_id=NEW.club_id AND p.tournament_id=NEW.tournament_id
       AND p.paid_by=NEW.actor_id AND p.prize_amount=NEW.amount AND p.method='cash' AND p.status='paid'
       AND private.is_verified_multi_day_payment_v1(p)
   ) THEN RETURN NEW; END IF;$new$);
END $migration$;

CREATE FUNCTION private.cashier_record_multiday_prize_drawer_outflow_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=auth.uid();
  shift public.cashier_till_shifts%ROWTYPE;
  available numeric;
BEGIN
  IF actor IS NULL OR NEW.paid_by IS DISTINCT FROM actor
     OR NOT public.is_club_cashier(actor,NEW.club_id)
     OR NOT private.is_verified_multi_day_payment_v1(NEW) THEN
    RAISE EXCEPTION 'cash_prize_drawer_actor_or_payment_invalid' USING ERRCODE='42501';
  END IF;
  -- Share the same row lock as drawer adjustment and shift close.
  SELECT * INTO shift FROM public.cashier_till_shifts
    WHERE club_id=NEW.club_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cash_prize_requires_open_shift' USING ERRCODE='23514';
  END IF;
  SELECT shift.opening_cash+coalesce(sum(CASE m.direction WHEN 'in' THEN m.amount ELSE -m.amount END),0)
    INTO available FROM public.cashier_buyin_movements m
    WHERE m.shift_id=shift.id AND m.method='cash';
  IF NEW.prize_amount<>trunc(NEW.prize_amount) OR NEW.prize_amount<=0 OR NEW.prize_amount>available THEN
    RAISE EXCEPTION 'cash_prize_drawer_amount_unavailable' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.cashier_buyin_movements
    (club_id,tournament_id,shift_id,prize_payment_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
  VALUES
    (NEW.club_id,NEW.tournament_id,shift.id,NEW.id,'out','cash','prize_payout',NEW.prize_amount,NEW.prize_amount,actor,'prize:'||NEW.id::text);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.cashier_record_multiday_prize_drawer_outflow_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER cashier_multiday_prize_drawer_outflow
AFTER INSERT ON public.tournament_prize_payments
FOR EACH ROW WHEN (NEW.multi_day_participation_id IS NOT NULL AND NEW.method='cash' AND NEW.status='paid')
EXECUTE FUNCTION private.cashier_record_multiday_prize_drawer_outflow_v1();

-- Keep the existing refund field and add a separate, authoritative prize debit.
-- The shift close already sums cash ledger movements by shift.
DO $migration$
DECLARE
  target regprocedure;
  definition text;
  cash_anchor text:=$old$'cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='refund'),0),$old$;
  prize_line text:=$new$
    'prize_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='prize_payout'),0),$new$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.cashier_shift_summary_v1(uuid)'::regprocedure,
    'public.cashier_cashflow_range_v1(uuid,timestamptz,timestamptz)'::regprocedure
  ] LOOP
    definition:=pg_get_functiondef(target);
    IF length(definition)-length(replace(definition,cash_anchor,''))<>length(cash_anchor) THEN
      RAISE EXCEPTION 'cashier_prize_drawer_summary_definition_drift: %',target;
    END IF;
    EXECUTE replace(definition,cash_anchor,cash_anchor||prize_line);
  END LOOP;
END $migration$;
COMMIT;
