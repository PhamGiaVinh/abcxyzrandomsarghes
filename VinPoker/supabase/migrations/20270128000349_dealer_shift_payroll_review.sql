BEGIN;
-- Read-only payroll exception list. A missing checkout is evidence of missing
-- information, never a payable duration or a zero-hour correction.
CREATE FUNCTION public.list_dealer_shift_payroll_reviews_v1(p_club uuid, p_from date, p_to date)
RETURNS TABLE(attendance_id uuid, dealer_id uuid, dealer_name text, shift_date date,
  checked_in_at timestamptz, checked_out_at timestamptz, table_name text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=p_club AND c.owner_id=auth.uid())
    OR EXISTS (SELECT 1 FROM public.club_accountants c WHERE c.club_id=p_club AND c.user_id=auth.uid())
  ) THEN RAISE EXCEPTION 'PAYROLL_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>31 THEN
    RAISE EXCEPTION 'PAYROLL_REVIEW_INVALID_PERIOD' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT a.id,d.id,d.full_name::text,a.shift_date,a.check_in_time,a.check_out_time,
    t.table_name::text, l.payload->>'reason'
  FROM public.dealers d JOIN public.dealer_attendance a ON a.dealer_id=d.id
  LEFT JOIN LATERAL (
    SELECT log.payload FROM public.audit_logs log WHERE log.club_id=p_club
      AND log.entity_type='dealer_attendance' AND log.entity_id=a.id
      AND log.action='manual_stale_shift_resolution'
    ORDER BY log.created_at DESC,log.id DESC LIMIT 1
  ) l ON true
  LEFT JOIN public.dealer_assignments b ON b.attendance_id=a.id AND b.club_id=p_club
    AND b.id::text=l.payload->>'assignment_id'
  LEFT JOIN public.game_tables t ON t.id=b.table_id AND t.club_id=p_club
  WHERE d.club_id=p_club AND a.shift_date BETWEEN p_from AND p_to
    AND a.status='checked_out' AND (a.check_in_time IS NULL OR a.check_out_time IS NULL
      OR l.payload->>'requires_payroll_review'='true')
  ORDER BY a.shift_date,d.full_name,a.id;
END $$;
REVOKE ALL ON FUNCTION public.list_dealer_shift_payroll_reviews_v1(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_dealer_shift_payroll_reviews_v1(uuid,date,date) TO authenticated;
COMMIT;
