-- Restore305 payment RPC only, without changing payment or monthly snapshot facts.
CREATE OR REPLACE FUNCTION public.mark_staff_salary_paid(p_run_id uuid, p_payment_method text DEFAULT NULL::text, p_payment_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_run record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_run from public.staff_salary_runs where id = p_run_id;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if not public._staff_salary_authorised(v_uid, v_run.club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  PERFORM floor_private.staff_salary_period_lock_v1(v_run.club_id,v_run.period_year,v_run.period_month);
  -- Consistent lock order: month, period header, run. Re-read after waiting.
  PERFORM 1 FROM public.staff_salary_periods WHERE club_id=v_run.club_id AND period_year=v_run.period_year AND period_month=v_run.period_month FOR UPDATE;
  SELECT * INTO v_run FROM public.staff_salary_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND');END IF;
  IF NOT public._staff_salary_authorised(v_uid,v_run.club_id) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501';END IF;
  -- [S7] owner must have approved the month's report before anyone can be marked paid.
  if not exists (
    select 1 from public.staff_salary_periods p
    where p.club_id = v_run.club_id and p.period_year = v_run.period_year
      and p.period_month = v_run.period_month and p.status = 'approved'
  ) then
    return jsonb_build_object('error', 'NOT_APPROVED', 'detail', 'Chủ CLB chưa duyệt bảng lương tháng này.');
  end if;
  if v_run.status <> 'locked' then
    return jsonb_build_object('status', v_run.status, 'idempotent', true, 'run_id', p_run_id);
  end if;

  update public.staff_salary_runs
  set status = 'paid', paid_at = now(), paid_by = v_uid,
      payment_method = p_payment_method, payment_reference = p_payment_reference
  where id = p_run_id and status = 'locked';

  return jsonb_build_object('status', 'paid', 'run_id', p_run_id, 'paid_at', now());
end;
$function$;

