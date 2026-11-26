BEGIN;
CREATE FUNCTION public.resolve_stale_dealer_shift_v1(
 p_club uuid, p_attendance uuid, p_assignment uuid, p_version integer,
 p_reason text, p_end timestamptz, p_release timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid := auth.uid();
 att public.dealer_attendance;
 binding public.dealer_assignments;
 club uuid;
BEGIN
 SELECT d.club_id INTO club FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
 WHERE a.id=p_attendance FOR SHARE OF d;
 PERFORM 1 FROM public.clubs WHERE id=club FOR SHARE;
 PERFORM 1 FROM public.club_dealer_controls WHERE club_id=club AND user_id=actor FOR SHARE;
 IF actor IS NULL OR club IS NULL OR club IS DISTINCT FROM p_club OR NOT coalesce(public.is_club_dealer_control(actor,club),false) THEN
   RAISE EXCEPTION 'Không có quyền xử lý ca tại CLB này';
 END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Cần lý do xử lý (3–1000 ký tự)'; END IF;
 IF p_assignment IS NOT NULL THEN
   SELECT * INTO binding FROM public.dealer_assignments WHERE id=p_assignment AND attendance_id=p_attendance AND club_id=club FOR UPDATE;
   IF NOT FOUND OR binding.version IS DISTINCT FROM p_version OR binding.released_at IS NOT NULL OR binding.status<>'assigned'
      OR binding.pre_assigned_attendance_id IS NOT NULL THEN RAISE EXCEPTION 'Phân bàn đã đổi. Tải lại trước khi xử lý'; END IF;
 END IF;
 SELECT * INTO STRICT att FROM public.dealer_attendance WHERE id=p_attendance FOR UPDATE;
 IF att.status<>'checked_in' OR att.check_out_time IS NOT NULL OR att.check_in_time>now()-interval '24 hours'
   OR att.pre_assigned_table_id IS NOT NULL THEN RAISE EXCEPTION 'Ca đã thay đổi hoặc chưa đủ điều kiện xử lý'; END IF;
 IF EXISTS(SELECT 1 FROM public.dealer_assignments a WHERE a.released_at IS NULL AND
   ((a.attendance_id=att.id AND a.status IN ('assigned','reserved','on_break') AND a.id IS DISTINCT FROM p_assignment)
   OR a.pre_assigned_attendance_id=att.id))
   OR EXISTS(SELECT 1 FROM public.dealer_breaks b WHERE b.attendance_id=att.id AND b.break_end IS NULL)
 THEN RAISE EXCEPTION 'Ca còn hoạt động khác. Kiểm tra lại trước khi đóng'; END IF;
 IF p_end>now() OR p_end<att.check_in_time OR p_end<att.last_released_at OR p_release>p_end
    OR (p_assignment IS NULL AND p_release IS NOT NULL)
    OR (p_assignment IS NOT NULL AND ((p_end IS NULL)<>(p_release IS NULL) OR p_release<binding.assigned_at OR p_release>now()))
 THEN RAISE EXCEPTION 'Giờ xác nhận mâu thuẫn với lịch sử ca'; END IF;
 IF p_assignment IS NOT NULL THEN
   UPDATE public.dealer_assignments SET status='completed',released_at=p_release,version=version+1,updated_at=now() WHERE id=binding.id;
 END IF;
 UPDATE public.dealer_attendance SET status='checked_out',current_state='checked_out',check_out_time=p_end,updated_at=now() WHERE id=att.id;
 INSERT INTO public.audit_logs(club_id,actor_id,action,entity_type,entity_id,payload)
 VALUES(club,actor,'manual_stale_shift_resolution','dealer_attendance',att.id,jsonb_build_object(
 'assignment_id',p_assignment,'reason',trim(p_reason),'processed_at',now(),'confirmed_checkout',p_end,
 'confirmed_release',p_release,'requires_payroll_review',true,'previous_state',att.current_state));
END $$;
REVOKE ALL ON FUNCTION public.resolve_stale_dealer_shift_v1(uuid,uuid,uuid,integer,text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_stale_dealer_shift_v1(uuid,uuid,uuid,integer,text,timestamptz,timestamptz) TO authenticated;
COMMIT;
