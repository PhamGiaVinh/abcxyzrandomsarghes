-- Local campaign reservation170 after catalog169. Production apply remains held.
-- Preserve actor ownership, inactive-staff checkout, current rounding and24h cap.
-- Recovery: suspend this writer with reviewed recovery script; never replay the
-- old racy function or rewrite attendance/payroll history.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $preflight$
DECLARE p record;
BEGIN
  SELECT prosrc,prosecdef,proowner INTO p FROM pg_proc
    WHERE oid=to_regprocedure('public.staff_check_out(uuid)');
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM '98c84e62f1bec71a69391acb143486fc'
    OR NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres'
    OR has_function_privilege('anon','public.staff_check_out(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.staff_check_out(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'staff_checkout170_definition_or_acl_drift';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.staff_check_out(p_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_open record;
  v_minutes integer;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id=p_staff_id AND s.user_id=v_uid AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode='42501';
  END IF;

  -- Recheck the open predicate after a competing checkout releases its lock.
  -- A waiter must not overwrite the committed close time/minutes of that row.
  SELECT * INTO v_open FROM public.staff_attendance
  WHERE staff_id=p_staff_id AND status='checked_in' AND check_out_time IS NULL
  LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','no_open_shift');
  END IF;

  v_minutes := LEAST(1440,GREATEST(0,EXTRACT(EPOCH FROM (now()-v_open.check_in_time))/60.0))::int;
  UPDATE public.staff_attendance SET
    status='checked_out',check_out_time=now(),
    total_worked_minutes_today=v_minutes,updated_at=now()
  WHERE id=v_open.id AND staff_id=p_staff_id
    AND status='checked_in' AND check_out_time IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_checkout_changed_refresh_required' USING errcode='40001';
  END IF;
  RETURN jsonb_build_object('outcome','checked_out','attendance_id',v_open.id,
    'check_in_time',v_open.check_in_time,'check_out_time',now(),
    'total_worked_minutes_today',v_minutes);
END;
$function$;
REVOKE ALL ON FUNCTION public.staff_check_out(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_check_out(uuid) TO authenticated,service_role;
COMMIT;
