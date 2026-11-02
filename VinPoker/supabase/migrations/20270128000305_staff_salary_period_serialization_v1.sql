-- Serialize canonical STAFF salary actions by club and month. No historical backfill.
-- Submitted/approved rosters stay frozen; existing locked/paid amounts remain untouched.
CREATE FUNCTION floor_private.staff_salary_period_lock_v1(p_club_id uuid,p_year integer,p_month integer)
RETURNS void LANGUAGE sql VOLATILE STRICT SET search_path='' AS $lock$
 SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vinpoker:staff_salary_period:v1:'||p_club_id::text||':'||p_year::text||':'||p_month::text,0));
$lock$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_period_lock_v1(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.approve_staff_salary_month(p_club_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cur text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- OWNER (or super_admin) only — the accountant cannot approve their own report.
  if not (public.has_role(v_uid, 'super_admin'::app_role) or public.is_club_owner(v_uid, p_club_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  PERFORM floor_private.staff_salary_period_lock_v1(p_club_id,p_year,p_month);
  select status into v_cur from public.staff_salary_periods
  where club_id = p_club_id and period_year = p_year and period_month = p_month FOR UPDATE;
  if v_cur is null then
    return jsonb_build_object('error', 'NOT_SUBMITTED', 'detail', 'Kế toán chưa gửi báo cáo tháng này.');
  end if;
  if v_cur = 'approved' then return jsonb_build_object('status', 'approved', 'idempotent', true); end if;
  if v_cur <> 'submitted' then return jsonb_build_object('error', 'INVALID_STATE', 'detail', v_cur); end if;

  update public.staff_salary_periods
  set status = 'approved', approved_by = v_uid, approved_at = now(), updated_at = now()
  where club_id = p_club_id and period_year = p_year and period_month = p_month;

  return jsonb_build_object('status', 'approved', 'club_id', p_club_id,
    'period_year', p_year, 'period_month', p_month, 'approved_at', now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.chot_staff_salary_month(p_club_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_from  date := make_date(p_year, p_month, 1);
  v_to    date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_std   int;
  v_locked int := 0;
  v_state text;
  r record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  PERFORM floor_private.staff_salary_period_lock_v1(p_club_id,p_year,p_month);
  SELECT status INTO v_state FROM public.staff_salary_periods WHERE club_id=p_club_id AND period_year=p_year AND period_month=p_month FOR UPDATE;
  IF v_state IN ('submitted','approved') THEN
    RETURN jsonb_build_object('status','ok','club_id',p_club_id,'period_year',p_year,'period_month',p_month,'locked_now',0,
      'total_net_vnd',(SELECT coalesce(sum(net_vnd),0) FROM public.staff_salary_runs WHERE club_id=p_club_id AND period_year=p_year AND period_month=p_month AND status<>'voided'));
  END IF;
  v_std := coalesce((select standard_shifts_per_month from public.club_settings where club_id = p_club_id limit 1), 26);

  for r in
    select s.id, s.employment_type, s.monthly_salary_vnd, s.manual_bhxh_vnd, s.manual_tax_vnd
    from public.staff s
    where s.club_id = p_club_id and s.status = 'active' and s.deleted_at is null
  loop
    -- skip if already locked/paid for this month (append-only; correction = separate later step)
    if exists (select 1 from public.staff_salary_runs sr
               where sr.staff_id = r.id and sr.period_year = p_year and sr.period_month = p_month
                 and sr.status <> 'voided') then
      continue;
    end if;

    if r.employment_type = 'part_time' then
      declare v_amt bigint; v_min int; begin
        select coalesce(sum(amount_vnd),0), coalesce(sum(minutes_paid),0) into v_amt, v_min
        from public.staff_pt_wage_payments
        where staff_id = r.id and voided_at is null and paid_at >= v_from and paid_at < v_to;
        insert into public.staff_salary_runs (
          club_id, staff_id, period_year, period_month, employment_type,
          worked_minutes, gross_vnd, manual_bhxh_vnd, manual_tax_vnd, net_vnd, status, locked_by)
        values (p_club_id, r.id, p_year, p_month, 'part_time',
          v_min, v_amt, 0, 0, v_amt, 'locked', v_uid)
        on conflict do nothing;
      end;
    else
      declare v_days int; v_gross bigint; v_bhxh bigint; v_tax bigint; begin
        select count(distinct shift_date) into v_days from public.staff_attendance
        where staff_id = r.id and shift_date >= v_from and shift_date < v_to;
        v_gross := floor(coalesce(r.monthly_salary_vnd,0)::numeric * least(v_days, v_std) / nullif(v_std,0))::bigint;
        v_bhxh  := coalesce(r.manual_bhxh_vnd, 0);
        v_tax   := coalesce(r.manual_tax_vnd, 0);
        insert into public.staff_salary_runs (
          club_id, staff_id, period_year, period_month, employment_type,
          worked_days, gross_vnd, manual_bhxh_vnd, manual_tax_vnd, net_vnd, status, locked_by)
        values (p_club_id, r.id, p_year, p_month, 'full_time',
          v_days, v_gross, v_bhxh, v_tax, greatest(0, v_gross - v_bhxh - v_tax), 'locked', v_uid)
        on conflict do nothing;
      end;
    end if;
    v_locked := v_locked + 1;
  end loop;

  return jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
    'locked_now', v_locked,
    'total_net_vnd', (select coalesce(sum(net_vnd),0) from public.staff_salary_runs
                      where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided'));
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.reject_staff_salary_month(p_club_id uuid, p_year integer, p_month integer, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cur text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not (public.has_role(v_uid, 'super_admin'::app_role) or public.is_club_owner(v_uid, p_club_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  PERFORM floor_private.staff_salary_period_lock_v1(p_club_id,p_year,p_month);
  select status into v_cur from public.staff_salary_periods
  where club_id = p_club_id and period_year = p_year and period_month = p_month FOR UPDATE;
  if v_cur is null or v_cur <> 'submitted' then
    return jsonb_build_object('error', 'INVALID_STATE', 'detail', coalesce(v_cur, 'none'));
  end if;

  update public.staff_salary_periods
  set status = 'rejected', rejected_by = v_uid, rejected_at = now(),
      rejected_reason = p_reason, updated_at = now()
  where club_id = p_club_id and period_year = p_year and period_month = p_month;

  return jsonb_build_object('status', 'rejected', 'reason', p_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_staff_salary_month(p_club_id uuid, p_year integer, p_month integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cnt int;
  v_cur text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  PERFORM floor_private.staff_salary_period_lock_v1(p_club_id,p_year,p_month);
  select count(*) into v_cnt from public.staff_salary_runs
  where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided';
  if v_cnt = 0 then
    return jsonb_build_object('error', 'NO_RUNS', 'detail', 'Chưa chốt lương tháng này (chạy chốt trước).');
  end if;

  select status into v_cur from public.staff_salary_periods
  where club_id = p_club_id and period_year = p_year and period_month = p_month FOR UPDATE;
  if v_cur = 'approved' then
    return jsonb_build_object('status', 'approved', 'idempotent', true);
  end if;

  insert into public.staff_salary_periods (
    club_id, period_year, period_month, status, prepared_by, prepared_at, submitted_by, submitted_at, note)
  values (p_club_id, p_year, p_month, 'submitted', v_uid, now(), v_uid, now(), p_note)
  on conflict (club_id, period_year, period_month) do update
    set status = 'submitted', submitted_by = v_uid, submitted_at = now(),
        note = coalesce(excluded.note, public.staff_salary_periods.note),
        rejected_reason = null, updated_at = now();

  return jsonb_build_object('status', 'submitted', 'club_id', p_club_id,
    'period_year', p_year, 'period_month', p_month, 'runs', v_cnt);
end;
$function$;
