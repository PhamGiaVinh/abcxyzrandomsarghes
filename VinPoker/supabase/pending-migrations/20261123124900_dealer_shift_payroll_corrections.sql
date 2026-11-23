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
  SET status = decision, decided_by = actor, decided_at = now(), decision_reason = btrim(p_reason)
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

COMMIT;