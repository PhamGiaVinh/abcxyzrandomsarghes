-- HOLD new freezes, retain private evidence/closed-policy reads and all saved records.
-- Coordinate with later supplement rollback; never delete source/receipt history.
DO $rollback_guard$ BEGIN IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.chot_staff_salary_month(uuid,integer,integer)'::regprocedure) NOT IN ('a873268e75e5f6d9c6d236fb633c79b9','d72e3c7ff70ae385a9bab496f07f78dc','7dad1b76046e7b619e2abed115ee8ace') THEN RAISE EXCEPTION 'staff_salary_closed_shift_rollback_drift';END IF;END $rollback_guard$;
CREATE OR REPLACE FUNCTION public.chot_staff_salary_month(p_club_id uuid,p_year integer,p_month integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $hold$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public._staff_salary_authorised(actor,p_club_id) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('error','STAFF_SALARY_CLOSED_POLICY_ROLLBACK_HOLD',
  'detail','Chốt lương đang tạm dừng để kiểm tra nguồn ca. Các phiếu đã chốt vẫn được giữ nguyên.');
END $hold$;
