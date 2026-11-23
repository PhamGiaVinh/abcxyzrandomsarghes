BEGIN;

-- One obligation per dealer and period. A replacement statement must not
-- create a second payment for the same obligation.
CREATE TABLE floor_private.dealer_monthly_individual_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  period_id uuid NOT NULL REFERENCES public.payroll_periods(id),
  dealer_id uuid NOT NULL REFERENCES public.dealers(id),
  statement_id uuid NOT NULL UNIQUE REFERENCES public.dealer_payroll_statements(id),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  method text NOT NULL CHECK (method IN ('cash','bank')),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 200),
  paid_by uuid NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (period_id, dealer_id),
  UNIQUE (club_id, method, reference)
);

ALTER TABLE floor_private.dealer_monthly_individual_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.dealer_monthly_individual_payments FROM PUBLIC, anon, authenticated;

CREATE FUNCTION floor_private.guard_monthly_voucher_against_individual_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('prepared', 'paid') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('dealer_payroll_corrections:' || NEW.club_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM floor_private.dealer_monthly_individual_payments payment
      WHERE payment.period_id = NEW.period_id AND payment.club_id = NEW.club_id
    ) THEN
      RAISE EXCEPTION 'DEALER_PAYROLL_INDIVIDUAL_PAYMENT_EXISTS' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.guard_monthly_voucher_against_individual_payment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_monthly_voucher_excludes_individual_payment
BEFORE INSERT OR UPDATE OF status ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_monthly_voucher_against_individual_payment();

CREATE FUNCTION public.pay_finalized_dealer_monthly_statement_v1(
  p_club uuid, p_statement uuid, p_expected_hash text, p_method text, p_reference text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  statement public.dealer_payroll_statements;
  period public.payroll_periods;
  payroll public.dealer_payroll;
  payment floor_private.dealer_monthly_individual_payments;
BEGIN
  IF actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.clubs WHERE id=p_club AND owner_id=actor)
    OR EXISTS (SELECT 1 FROM public.club_cashiers WHERE club_id=p_club AND user_id=actor)
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_PAYMENT_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT statement FROM public.dealer_payroll_statements
  WHERE id=p_statement AND club_id=p_club AND statement_kind='full_time_period';
  SELECT * INTO STRICT period FROM public.payroll_periods
  WHERE id=statement.payroll_period_id AND club_id=p_club FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('dealer_payroll_corrections:' || p_club::text, 0));

  IF NOT (
    EXISTS (SELECT 1 FROM public.clubs WHERE id=p_club AND owner_id=actor)
    OR EXISTS (SELECT 1 FROM public.club_cashiers WHERE club_id=p_club AND user_id=actor)
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_PAYMENT_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT statement FROM public.dealer_payroll_statements
  WHERE id=p_statement AND club_id=p_club AND payroll_period_id=period.id
    AND statement_kind='full_time_period' FOR UPDATE;
  IF p_expected_hash IS DISTINCT FROM statement.statement_hash THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_SNAPSHOT_STALE' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO payment FROM floor_private.dealer_monthly_individual_payments
  WHERE period_id=period.id AND dealer_id=statement.dealer_id AND club_id=p_club;
  IF FOUND THEN
    RETURN jsonb_build_object('payment_id',payment.id,'statement_id',payment.statement_id,
      'amount_vnd',payment.amount_vnd,'remaining_vnd',0,'reference',payment.reference);
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_records WHERE period_id=period.id) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_GROUP_VOUCHER_REQUIRES_RECONCILIATION' USING ERRCODE='P0001';
  END IF;
  IF period.status <> 'locked' OR statement.state NOT IN ('finalized','pdf_rendered','delivery_failed','sent')
    OR statement.net_amount_vnd <= 0 OR statement.payment_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_STATEMENT_NOT_PAYABLE' USING ERRCODE='P0001';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash','bank')
    OR length(btrim(coalesce(p_reference,''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_PAYMENT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT * INTO STRICT payroll FROM public.dealer_payroll
  WHERE id=statement.source_dealer_payroll_id AND period_id=period.id AND club_id=p_club
    AND dealer_id=statement.dealer_id AND status <> 'excluded' FOR SHARE;

  IF floor_private.dealer_payroll_has_unresolved_work(p_club,statement.dealer_id,period.period_start,period.period_end) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_UNRESOLVED_WORK' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM floor_private.dealer_payroll_effective_attendance attendance
    JOIN floor_private.dealer_shift_payroll_corrections correction ON correction.id=attendance.payroll_correction_id
    WHERE attendance.dealer_id=statement.dealer_id AND correction.club_id=p_club
      AND (payroll.calculated_at IS NULL OR correction.decided_at >= LEAST(payroll.calculated_at,statement.finalized_at))
      AND (
        attendance.shift_date BETWEEN period.period_start AND period.period_end
        OR (attendance.check_in_time < ((period.period_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND attendance.check_out_time > (period.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
        OR (correction.original_check_in < ((period.period_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND correction.original_check_out > (period.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
      )
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_SNAPSHOT_STALE' USING ERRCODE='P0001';
  END IF;

  INSERT INTO floor_private.dealer_monthly_individual_payments(
    club_id,period_id,dealer_id,statement_id,amount_vnd,method,reference,paid_by
  ) VALUES (p_club,period.id,statement.dealer_id,statement.id,statement.net_amount_vnd,p_method,btrim(p_reference),actor)
  RETURNING * INTO payment;
  RETURN jsonb_build_object('payment_id',payment.id,'statement_id',payment.statement_id,
    'amount_vnd',payment.amount_vnd,'remaining_vnd',0,'reference',payment.reference);
END;
$$;

REVOKE ALL ON FUNCTION public.pay_finalized_dealer_monthly_statement_v1(uuid,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_finalized_dealer_monthly_statement_v1(uuid,uuid,text,text,text) TO authenticated;

CREATE FUNCTION floor_private.guard_paid_individual_monthly_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.state IN ('voided', 'replaced') AND NEW.state IS DISTINCT FROM OLD.state
    AND EXISTS (
      SELECT 1
      FROM floor_private.dealer_monthly_individual_payments payment
      WHERE payment.statement_id = OLD.id
    )
  THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_PAID_STATEMENT_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION floor_private.guard_paid_individual_monthly_statement() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_monthly_paid_statement_rejects_void_or_replace
BEFORE UPDATE OF state ON public.dealer_payroll_statements
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_paid_individual_monthly_statement();

COMMIT;