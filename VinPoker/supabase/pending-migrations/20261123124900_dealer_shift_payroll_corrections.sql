BEGIN;

CREATE TABLE floor_private.dealer_shift_payroll_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  attendance_id uuid NOT NULL REFERENCES public.dealer_attendance(id),
  original_updated_at timestamptz,
  original_check_in timestamptz,
  original_check_out timestamptz,
  proposed_check_in timestamptz NOT NULL,
  proposed_check_out timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  proposed_by uuid NOT NULL,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  status text NOT NULL DEFAULT 'pending',
  CHECK (proposed_check_out >= proposed_check_in),
  CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL
        AND decided_by <> proposed_by AND length(btrim(coalesce(decision_reason, ''))) BETWEEN 3 AND 1000)
  )
);

CREATE UNIQUE INDEX dealer_shift_one_pending_payroll_correction
ON floor_private.dealer_shift_payroll_corrections(attendance_id)
WHERE status = 'pending';

ALTER TABLE floor_private.dealer_shift_payroll_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.dealer_shift_payroll_corrections FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.propose_dealer_shift_payroll_correction_v1(
  p_club uuid, p_attendance uuid, p_expected_updated_at timestamptz,
  p_check_in timestamptz, p_check_out timestamptz, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  attendance public.dealer_attendance;
  correction_id uuid;
BEGIN
  PERFORM 1 FROM public.club_accountants
  WHERE club_id = p_club AND user_id = actor FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO attendance
  FROM public.dealer_attendance a JOIN public.dealers d ON d.id = a.dealer_id
  WHERE a.id = p_attendance AND d.club_id = p_club
  FOR UPDATE OF a FOR SHARE OF d;
  IF NOT FOUND OR attendance.status <> 'checked_out'
    OR attendance.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_STALE' USING ERRCODE = 'P0001';
  END IF;
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_out < p_check_in OR p_check_out > now()
    OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO floor_private.dealer_shift_payroll_corrections(
    club_id, attendance_id, original_updated_at, original_check_in, original_check_out,
    proposed_check_in, proposed_check_out, reason, proposed_by
  ) VALUES (
    p_club, attendance.id, attendance.updated_at, attendance.check_in_time, attendance.check_out_time,
    p_check_in, p_check_out, btrim(p_reason), actor
  ) RETURNING id INTO correction_id;
  RETURN correction_id;
END;
$$;

CREATE FUNCTION public.decide_dealer_shift_payroll_correction_v1(
  p_club uuid, p_correction uuid, p_approve boolean, p_reason text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  correction floor_private.dealer_shift_payroll_corrections;
  attendance public.dealer_attendance;
  decision text;
BEGIN
  PERFORM 1 FROM public.clubs WHERE id = p_club AND owner_id = actor FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL OR length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO correction FROM floor_private.dealer_shift_payroll_corrections c
  WHERE c.id = p_correction AND c.club_id = p_club;
  IF NOT FOUND OR correction.proposed_by = actor THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Serialize decisions with ledger writes before locking attendance.
  PERFORM pg_advisory_xact_lock(hashtextextended('dealer_payroll_corrections:' || p_club::text, 0));
  -- Match the proposal writer: lock the attendance before the correction.
  PERFORM 1 FROM public.dealer_attendance WHERE id = correction.attendance_id FOR UPDATE;
  SELECT c.* INTO STRICT correction FROM floor_private.dealer_shift_payroll_corrections c
  WHERE c.id = p_correction AND c.club_id = p_club FOR UPDATE;

  decision := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  IF correction.status = decision THEN
    RETURN decision;
  END IF;
  IF correction.status <> 'pending' THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_STALE' USING ERRCODE = 'P0001';
  END IF;

  IF p_approve THEN
    SELECT a.* INTO attendance
    FROM public.dealer_attendance a JOIN public.dealers d ON d.id = a.dealer_id
    WHERE a.id = correction.attendance_id AND d.club_id = p_club
    FOR UPDATE OF a FOR SHARE OF d;
    IF NOT FOUND OR attendance.status <> 'checked_out'
      OR attendance.updated_at IS DISTINCT FROM correction.original_updated_at
      OR attendance.check_in_time IS DISTINCT FROM correction.original_check_in
      OR attendance.check_out_time IS DISTINCT FROM correction.original_check_out THEN
      RAISE EXCEPTION 'PAYROLL_CORRECTION_STALE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE floor_private.dealer_shift_payroll_corrections
  SET status = decision, decided_by = actor, decided_at = clock_timestamp(), decision_reason = btrim(p_reason)
  WHERE id = correction.id;
  RETURN decision;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_dealer_shift_payroll_correction_v1(uuid,uuid,timestamptz,timestamptz,timestamptz,text),
  public.decide_dealer_shift_payroll_correction_v1(uuid,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_dealer_shift_payroll_correction_v1(uuid,uuid,timestamptz,timestamptz,timestamptz,text),
  public.decide_dealer_shift_payroll_correction_v1(uuid,uuid,boolean,text) TO authenticated;

CREATE FUNCTION public.list_dealer_shift_payroll_corrections_v1(p_club uuid, p_from date, p_to date)
RETURNS TABLE(
  id uuid, attendance_id uuid, dealer_name text, shift_date date,
  original_check_in timestamptz, original_check_out timestamptz,
  proposed_check_in timestamptz, proposed_check_out timestamptz,
  reason text, status text, decision_reason text, can_decide boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  is_owner boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.clubs WHERE clubs.id = p_club AND owner_id = actor)
  INTO is_owner;
  IF NOT is_owner AND NOT EXISTS (
    SELECT 1 FROM public.club_accountants WHERE club_id = p_club AND user_id = actor
  ) THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.id, c.attendance_id, d.full_name::text, a.shift_date,
    c.original_check_in, c.original_check_out, c.proposed_check_in, c.proposed_check_out,
    c.reason, c.status, c.decision_reason, is_owner AND c.status = 'pending' AND c.proposed_by <> actor
  FROM floor_private.dealer_shift_payroll_corrections c
  JOIN public.dealer_attendance a ON a.id = c.attendance_id
  JOIN public.dealers d ON d.id = a.dealer_id AND d.club_id = c.club_id
  WHERE c.club_id = p_club AND a.shift_date BETWEEN p_from AND p_to
  ORDER BY (c.status = 'pending') DESC, c.proposed_at DESC, c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_dealer_shift_payroll_corrections_v1(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_dealer_shift_payroll_corrections_v1(uuid,date,date) TO authenticated;

CREATE FUNCTION public.get_dealer_shift_payroll_correction_context_v1(p_club uuid, p_attendance uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  context jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.club_accountants
    WHERE club_id = p_club AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('updated_at', a.updated_at,
    'check_in', a.check_in_time, 'check_out', a.check_out_time)
  INTO context
  FROM public.dealer_attendance a
  JOIN public.dealers d ON d.id = a.dealer_id
  WHERE a.id = p_attendance AND d.club_id = p_club AND a.status = 'checked_out';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_STALE' USING ERRCODE = 'P0001';
  END IF;
  RETURN context;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dealer_shift_payroll_correction_context_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dealer_shift_payroll_correction_context_v1(uuid,uuid) TO authenticated;

-- Payroll readers can consume approved hours while retaining the Swing record.
-- Invalidate the answer when the underlying attendance revision changes.
CREATE VIEW floor_private.dealer_payroll_effective_attendance
WITH (security_invoker = true) AS
SELECT a.id, a.dealer_id, a.shift_date, a.status, a.overtime_minutes, a.total_worked_minutes_today,
  CASE WHEN correction.id IS NULL THEN a.check_in_time ELSE correction.proposed_check_in END AS check_in_time,
  CASE WHEN correction.id IS NULL THEN a.check_out_time ELSE correction.proposed_check_out END AS check_out_time,
  correction.id AS payroll_correction_id
FROM public.dealer_attendance a
JOIN public.dealers d ON d.id = a.dealer_id
LEFT JOIN LATERAL (
  SELECT c.id, c.proposed_check_in, c.proposed_check_out
  FROM floor_private.dealer_shift_payroll_corrections c
  WHERE a.status = 'checked_out'
    AND c.club_id = d.club_id
    AND c.attendance_id = a.id
    AND c.status = 'approved'
    AND c.original_updated_at IS NOT DISTINCT FROM a.updated_at
    AND c.original_check_in IS NOT DISTINCT FROM a.check_in_time
    AND c.original_check_out IS NOT DISTINCT FROM a.check_out_time
  ORDER BY c.decided_at DESC, c.id DESC
  LIMIT 1
) correction ON true;

REVOKE ALL ON floor_private.dealer_payroll_effective_attendance FROM PUBLIC, anon, authenticated;

-- PT readers use effective hours for the anchor and accrual windows. Live
-- check-in state is still read from Swing. Treat incomplete closed attendance
-- as unresolved instead of extending its duration to now.
DO $integration$
DECLARE
  definition text := pg_get_functiondef('public._pt_wage_balance(uuid)'::regprocedure);
  anchor_source text := 'from public.dealer_attendance' || chr(10) ||
    '      where dealer_id = p_dealer_id and check_in_time is not null';
  window_source text := 'from public.dealer_attendance da' || chr(10) ||
    '      where da.dealer_id = p_dealer_id';
BEGIN
  IF (length(definition) - length(replace(definition, anchor_source, ''))) <> length(anchor_source)
    OR (length(definition) - length(replace(definition, window_source, ''))) <> length(window_source)
  THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_PT_CATALOG_DRIFT';
  END IF;
  definition := replace(definition, anchor_source,
    replace(anchor_source, 'public.dealer_attendance', 'floor_private.dealer_payroll_effective_attendance'));
  definition := replace(definition, window_source,
    replace(window_source, 'public.dealer_attendance', 'floor_private.dealer_payroll_effective_attendance') || chr(10) ||
    '        and (da.status = ''checked_in'' or da.check_out_time >= da.check_in_time)');
  EXECUTE definition;
END;
$integration$;

DO $integration$
DECLARE
  definition text := pg_get_functiondef('public.calculate_dealer_payroll(uuid,date,date,integer)'::regprocedure);
  attendance_source text := 'FROM public.dealer_attendance da' || chr(10) ||
    '    WHERE da.dealer_id = p_dealer_id';
BEGIN
  IF (length(definition) - length(replace(definition, attendance_source, ''))) <> length(attendance_source) THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_FT_CATALOG_DRIFT';
  END IF;
  EXECUTE replace(definition, attendance_source,
    replace(attendance_source, 'public.dealer_attendance', 'floor_private.dealer_payroll_effective_attendance') || chr(10) ||
    '      AND (da.status = ''checked_in'' OR da.check_out_time >= da.check_in_time)');
END;
$integration$;

-- A frozen statement must be replaced if an approved correction was not part
-- of its snapshot. This guard runs only for a new finalized-statement payment.
CREATE FUNCTION floor_private.guard_dealer_pt_payment_correction_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dealer_payroll_corrections:' || NEW.club_id::text, 0));
  IF NEW.statement_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dealer_pt_wage_settlements settlement
    JOIN floor_private.dealer_payroll_effective_attendance attendance ON attendance.dealer_id = settlement.dealer_id
    JOIN floor_private.dealer_shift_payroll_corrections correction ON correction.id = attendance.payroll_correction_id
    WHERE settlement.statement_id = NEW.statement_id
      AND settlement.club_id = NEW.club_id
      AND settlement.dealer_id = NEW.dealer_id
      AND correction.decided_at >= settlement.finalized_at
      AND (
        (attendance.check_in_time < settlement.covered_to AND attendance.check_out_time > settlement.covered_from)
        OR (correction.original_check_in < settlement.covered_to AND correction.original_check_out > settlement.covered_from)
        OR attendance.shift_date BETWEEN
          (settlement.covered_from AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
          AND ((settlement.covered_to - interval '1 microsecond') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      )
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_SNAPSHOT_STALE' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION floor_private.guard_dealer_pt_payment_correction_revision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_pt_payment_require_current_correction_revision
BEFORE INSERT ON public.dealer_pt_wage_payments
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_pt_payment_correction_revision();

CREATE OR REPLACE FUNCTION floor_private.dealer_payroll_has_unresolved_work(
  p_club uuid, p_dealer uuid, p_from date, p_to date
)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM floor_private.dealer_payroll_effective_attendance attendance
    JOIN public.dealers dealer ON dealer.id = attendance.dealer_id
    WHERE dealer.club_id = p_club AND dealer.id = p_dealer
      AND attendance.shift_date BETWEEN p_from AND p_to
      AND attendance.status = 'checked_out'
      AND (
        attendance.check_in_time IS NULL OR attendance.check_out_time IS NULL
        OR attendance.check_out_time < attendance.check_in_time
      )
  );
$$;

CREATE FUNCTION floor_private.guard_dealer_monthly_correction_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status NOT IN ('prepared', 'paid') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('dealer_payroll_corrections:' || NEW.club_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.payroll_periods period
    JOIN public.dealer_payroll payroll ON payroll.period_id = period.id AND payroll.club_id = period.club_id
    JOIN floor_private.dealer_payroll_effective_attendance attendance ON attendance.dealer_id = payroll.dealer_id
    JOIN floor_private.dealer_shift_payroll_corrections correction ON correction.id = attendance.payroll_correction_id
    WHERE period.id = NEW.period_id AND period.club_id = NEW.club_id
      AND payroll.status <> 'excluded'
      AND (
        (attendance.check_in_time < ((period.period_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND attendance.check_out_time > (period.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
        OR (correction.original_check_in < ((period.period_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND correction.original_check_out > (period.period_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
        OR attendance.shift_date BETWEEN period.period_start AND period.period_end
      )
      AND (payroll.calculated_at IS NULL OR correction.decided_at >= payroll.calculated_at)
  ) THEN
    RAISE EXCEPTION 'DEALER_PAYROLL_SNAPSHOT_STALE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION floor_private.guard_dealer_monthly_correction_revision() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER dealer_monthly_require_current_correction_revision
BEFORE INSERT OR UPDATE OF status ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_dealer_monthly_correction_revision();

COMMIT;