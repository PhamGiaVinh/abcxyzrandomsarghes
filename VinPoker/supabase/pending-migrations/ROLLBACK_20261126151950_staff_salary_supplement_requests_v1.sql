-- HOLD new requests/approvals; retain private evidence, child guards, approved receipts, compatible readers and base uniqueness.
-- Do NOT restore the original one-row index once children exist, delete requests or revert to an incompatible frontend.
DO $rollback_guards$ BEGIN
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.refresh_staff_salary_adjustment_v1(uuid)'::regprocedure) NOT IN ('2cfed54778e95eeb2858e892d13602a6','59ef1d0290b700428b3ee97d255c647f') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_ROLLBACK_DRIFT';END IF;
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.approve_staff_salary_adjustment_v1(uuid)'::regprocedure) NOT IN ('a6a0194019fa99696053ec51d8d66461','2f2ccd5292b359ffc71ee586003c06a8') THEN RAISE EXCEPTION 'STAFF_SALARY_SUPPLEMENT_ROLLBACK_DRIFT';END IF;
END $rollback_guards$;
DROP TRIGGER IF EXISTS staff_salary_checkout_adjustment_v1 ON public.staff_attendance;
CREATE OR REPLACE FUNCTION public.refresh_staff_salary_adjustment_v1(p_base_run_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $hold$
DECLARE base public.staff_salary_runs%ROWTYPE;
BEGIN
 SELECT * INTO base FROM public.staff_salary_runs WHERE id=p_base_run_id;
 IF NOT FOUND OR NOT floor_private.staff_salary_adjustment_operator_v1(auth.uid(),base.club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('error','STAFF_SALARY_ADJUSTMENT_ROLLBACK_HOLD','detail','Điều chỉnh lương đang tạm dừng. Các chứng từ đã duyệt và đã ghi chi vẫn được giữ nguyên.');
END $hold$;
CREATE OR REPLACE FUNCTION public.approve_staff_salary_adjustment_v1(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $hold$
DECLARE request floor_private.staff_salary_adjustment_requests_v1%ROWTYPE;actor uuid:=auth.uid();
BEGIN
 SELECT * INTO request FROM floor_private.staff_salary_adjustment_requests_v1 WHERE id=p_request_id;
 IF NOT FOUND OR actor IS NULL OR NOT(public.has_role(actor,'super_admin'::public.app_role) OR EXISTS(SELECT 1 FROM public.clubs WHERE id=request.club_id AND owner_id=actor)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('error','STAFF_SALARY_ADJUSTMENT_ROLLBACK_HOLD','detail','Duyệt điều chỉnh đang tạm dừng. Các chứng từ đã duyệt và đã ghi chi vẫn được giữ nguyên.');
END $hold$;
