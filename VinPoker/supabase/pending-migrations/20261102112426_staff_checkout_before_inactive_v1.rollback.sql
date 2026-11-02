-- Restore exact predecessor functions; no attendance or wage data undo.
DO $catalog$ BEGIN
  ASSERT md5(replace(pg_get_functiondef('public.staff_check_in(uuid)'::regprocedure),chr(13),''))='59768aef1d4aabd9b8c63d8f18c1a00d','staff_checkout_before_inactive_catalog_mismatch';
  ASSERT md5(replace(pg_get_functiondef('public.staff_upsert(uuid,text,staff_department,text,uuid,text,bigint,integer,numeric,bigint,bigint,text)'::regprocedure),chr(13),''))='a1bb8108daa79b4210b7298ab986abfc','staff_checkout_before_inactive_catalog_mismatch';
END $catalog$;
CREATE OR REPLACE FUNCTION public.staff_upsert(p_club_id uuid, p_full_name text, p_department staff_department, p_employment_type text DEFAULT 'full_time'::text, p_staff_id uuid DEFAULT NULL::uuid, p_phone text DEFAULT NULL::text, p_monthly_salary_vnd bigint DEFAULT NULL::bigint, p_hourly_rate_vnd integer DEFAULT NULL::integer, p_standard_hours_per_shift numeric DEFAULT NULL::numeric, p_manual_bhxh_vnd bigint DEFAULT NULL::bigint, p_manual_tax_vnd bigint DEFAULT NULL::bigint, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_name');
  END IF;
  IF length(btrim(p_full_name)) > 120 THEN                                     -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_name too long');
  END IF;
  IF p_phone IS NOT NULL AND length(btrim(p_phone)) > 30 THEN                  -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'phone too long');
  END IF;
  IF p_employment_type NOT IN ('full_time', 'part_time') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'employment_type');
  END IF;
  IF COALESCE(p_status, 'active') NOT IN ('active', 'inactive') THEN           -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'status');
  END IF;
  IF COALESCE(p_monthly_salary_vnd, 0) < 0 OR COALESCE(p_hourly_rate_vnd, 0) < 0
     OR COALESCE(p_standard_hours_per_shift, 0) < 0
     OR COALESCE(p_manual_bhxh_vnd, 0) < 0 OR COALESCE(p_manual_tax_vnd, 0) < 0 THEN  -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'amounts must be >= 0');
  END IF;
  IF p_employment_type = 'full_time' AND COALESCE(p_monthly_salary_vnd, 0) <= 0 THEN  -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_time requires monthly_salary_vnd');
  END IF;
  IF p_employment_type = 'part_time' AND COALESCE(p_hourly_rate_vnd, 0) <= 0 THEN     -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'part_time requires hourly_rate_vnd');
  END IF;

  -- Authz: operator of p_club_id (Owner+Cashier) or accountant.
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
    OR public.is_club_accountant(v_uid, p_club_id)   -- [ACCT]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_staff_id IS NULL THEN
    INSERT INTO public.staff (
      club_id, full_name, phone, department, employment_type,
      monthly_salary_vnd, hourly_rate_vnd, standard_hours_per_shift,
      manual_bhxh_vnd, manual_tax_vnd, status
    ) VALUES (
      p_club_id, btrim(p_full_name), p_phone, p_department, p_employment_type,
      p_monthly_salary_vnd, p_hourly_rate_vnd, p_standard_hours_per_shift,
      p_manual_bhxh_vnd, p_manual_tax_vnd, COALESCE(p_status, 'active')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.staff SET
      full_name                = btrim(p_full_name),
      phone                    = p_phone,
      department               = p_department,
      employment_type          = p_employment_type,
      monthly_salary_vnd       = p_monthly_salary_vnd,
      hourly_rate_vnd          = p_hourly_rate_vnd,
      standard_hours_per_shift = p_standard_hours_per_shift,
      manual_bhxh_vnd          = p_manual_bhxh_vnd,
      manual_tax_vnd           = p_manual_tax_vnd,
      status                   = COALESCE(p_status, 'active'),
      updated_at               = now()
    WHERE id = p_staff_id AND club_id = p_club_id AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'NOT_FOUND', 'detail', 'staff row not in this club');
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'staff_id', v_id, 'club_id', p_club_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_check_in(p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_open record;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                 WHERE s.id = p_staff_id AND s.user_id = v_uid
                   AND s.deleted_at IS NULL AND s.status = 'active') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Already checked in → return the open shift (idempotent).
  SELECT * INTO v_open FROM public.staff_attendance
  WHERE staff_id = p_staff_id AND status = 'checked_in' AND check_out_time IS NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'already_checked_in', 'attendance_id', v_open.id,
                              'check_in_time', v_open.check_in_time);
  END IF;

  BEGIN
    INSERT INTO public.staff_attendance (staff_id, shift_date, check_in_time, status)
    VALUES (p_staff_id, CURRENT_DATE, now(), 'checked_in')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent check-in won the race → return that open row.
    SELECT id INTO v_id FROM public.staff_attendance
    WHERE staff_id = p_staff_id AND status = 'checked_in' AND check_out_time IS NULL
    LIMIT 1;
    RETURN jsonb_build_object('outcome', 'already_checked_in', 'attendance_id', v_id);
  END;

  RETURN jsonb_build_object('outcome', 'checked_in', 'attendance_id', v_id, 'check_in_time', now());
END;
$function$;
