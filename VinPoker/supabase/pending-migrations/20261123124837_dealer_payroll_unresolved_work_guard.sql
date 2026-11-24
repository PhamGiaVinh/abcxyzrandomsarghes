-- Internal predicate for payroll writers whose attendance coverage is expressed
-- in club business dates. The writer must check it inside its payment transaction.
BEGIN;

CREATE FUNCTION floor_private.dealer_payroll_has_unresolved_work(
  p_club uuid, p_dealer uuid, p_from date, p_to date
)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dealer_attendance AS attendance
    JOIN public.dealers AS dealer ON dealer.id = attendance.dealer_id
    WHERE dealer.club_id = p_club
      AND dealer.id = p_dealer
      AND attendance.shift_date BETWEEN p_from AND p_to
      AND attendance.status = 'checked_out'
      AND (
        attendance.check_in_time IS NULL
        OR attendance.check_out_time IS NULL
        OR attendance.check_out_time < attendance.check_in_time
      )
  );
$$;

REVOKE ALL ON FUNCTION floor_private.dealer_payroll_has_unresolved_work(uuid,uuid,date,date)
FROM PUBLIC, anon, authenticated;

-- Both direct payment and finalized-statement payment insert into this same
-- ledger. A readback of an existing receipt performs no insert.
CREATE FUNCTION floor_private.guard_dealer_pt_work_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  first_date date := (NEW.covered_from AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  final_date date := ((NEW.covered_to - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dealer_payroll_corrections:' || NEW.club_id::text, 0));
  IF NEW.covered_from IS NULL OR NEW.covered_to IS NULL OR NEW.covered_to <= NEW.covered_from THEN
    RAISE EXCEPTION 'PT_PAYROLL_INVALID_COVERAGE' USING ERRCODE = '22023';
  END IF;
  IF floor_private.dealer_payroll_has_unresolved_work(
    NEW.club_id, NEW.dealer_id, first_date, final_date
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_UNRESOLVED_WORK' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION floor_private.guard_dealer_pt_work_before_insert()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_pt_settlement_require_resolved_work
BEFORE INSERT ON public.dealer_pt_wage_settlements
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_pt_work_before_insert();

CREATE TRIGGER dealer_pt_payment_require_resolved_work
BEFORE INSERT ON public.dealer_pt_wage_payments
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_pt_work_before_insert();

-- Legacy monthly vouchers represent the whole period. Keep the original
-- voucher intact and hold preparation or payment if any included row is unresolved.
CREATE FUNCTION floor_private.guard_dealer_monthly_voucher_work()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  covered_period public.payroll_periods;
BEGIN
  IF NEW.status NOT IN ('prepared', 'paid') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT period.* INTO STRICT covered_period
  FROM public.payroll_periods AS period
  WHERE period.id = NEW.period_id AND period.club_id = NEW.club_id;

  IF EXISTS (
    SELECT 1 FROM public.dealer_payroll AS payroll
    WHERE payroll.period_id = covered_period.id
      AND payroll.club_id = covered_period.club_id
      AND payroll.status <> 'excluded'
      AND floor_private.dealer_payroll_has_unresolved_work(
        payroll.club_id, payroll.dealer_id, covered_period.period_start, covered_period.period_end
      )
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_UNRESOLVED_WORK' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION floor_private.guard_dealer_monthly_voucher_work()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_monthly_voucher_require_resolved_work
BEFORE INSERT OR UPDATE OF status ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_monthly_voucher_work();

COMMIT;