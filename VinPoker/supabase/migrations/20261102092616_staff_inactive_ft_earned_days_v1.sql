-- Owner decision 2026-11-02: preserve earned FT workdays after inactive; permit monthly freeze.
-- Isolated-local candidate. Uses existing salary arithmetic, authority, locks and append-only runs.
-- Open inactive attendance remains unavailable pending explicit checkout policy.
DO $catalog$ BEGIN
  ASSERT md5(replace(pg_get_functiondef('public.get_staff_salary_month(uuid,integer,integer)'::regprocedure),chr(13),''))='0966af6bb602133784d2d3676d1f281b','staff_inactive_ft_requires_exact_catalog';
  ASSERT md5(replace(pg_get_functiondef('public.chot_staff_salary_month(uuid,integer,integer)'::regprocedure),chr(13),''))='e592cb8165926a4643f13a649c24bd25','staff_inactive_ft_requires_exact_catalog';
END $catalog$;
CREATE OR REPLACE FUNCTION public.get_staff_salary_month(p_club_id uuid, p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_std  int;
  v_rows jsonb := '[]'::jsonb;
  r record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_std := coalesce((select standard_shifts_per_month from public.club_settings where club_id = p_club_id limit 1), 26);

  -- Inactive attendance needs an explicit end; never infer a departure cutoff.
  if exists (
    select 1 from public.staff s join public.staff_attendance a on a.staff_id=s.id
    where s.club_id=p_club_id and s.status='inactive' and s.deleted_at is null
      and s.employment_type='full_time' and a.shift_date>=v_from and a.shift_date<v_to
      and a.check_in_time is not null and a.check_out_time is null
      and not exists (select 1 from public.staff_salary_runs sr
        where sr.staff_id=s.id and sr.period_year=p_year and sr.period_month=p_month
          and sr.status<>'voided')
  ) then
    raise exception 'STAFF_INACTIVE_FT_ATTENDANCE_END_REQUIRED' using errcode='22023';
  end if;

  for r in
    select s.id, s.full_name, s.department, s.employment_type,
           s.monthly_salary_vnd, s.manual_bhxh_vnd, s.manual_tax_vnd
    from public.staff s
    where s.club_id = p_club_id and s.deleted_at is null
      and (s.status = 'active' or (
        s.status = 'inactive' and s.employment_type = 'full_time'
        and exists (select 1 from public.staff_attendance a
          where a.staff_id = s.id and a.shift_date >= v_from and a.shift_date < v_to
            and a.check_in_time is not null and a.check_out_time is not null)
      ))
    order by s.employment_type, s.full_name
  loop
    if r.employment_type = 'part_time' then
      declare v_amt bigint; v_min int; begin
        select coalesce(sum(amount_vnd),0), coalesce(sum(minutes_paid),0) into v_amt, v_min
        from public.staff_pt_wage_payments
        where staff_id = r.id and voided_at is null and paid_at >= v_from and paid_at < v_to;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'staff_id', r.id, 'full_name', r.full_name, 'department', r.department, 'employment_type', 'part_time',
          'worked_minutes', v_min, 'gross_vnd', v_amt, 'manual_bhxh_vnd', 0, 'manual_tax_vnd', 0, 'net_vnd', v_amt,
          'basis', 'PT payouts summed for the month', 'already_locked',
          exists(select 1 from public.staff_salary_runs sr where sr.staff_id = r.id and sr.period_year = p_year and sr.period_month = p_month and sr.status <> 'voided')));
      end;
    else
      declare v_days int; v_gross bigint; v_bhxh bigint; v_tax bigint; begin
        select count(distinct shift_date) into v_days from public.staff_attendance
        where staff_id = r.id and shift_date >= v_from and shift_date < v_to;
        v_gross := floor(coalesce(r.monthly_salary_vnd,0)::numeric * least(v_days, v_std) / nullif(v_std,0))::bigint;
        v_bhxh  := coalesce(r.manual_bhxh_vnd, 0);
        v_tax   := coalesce(r.manual_tax_vnd, 0);
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'staff_id', r.id, 'full_name', r.full_name, 'department', r.department, 'employment_type', 'full_time',
          'worked_days', v_days, 'standard_shifts_per_month', v_std,
          'gross_vnd', v_gross, 'manual_bhxh_vnd', v_bhxh, 'manual_tax_vnd', v_tax,
          'net_vnd', greatest(0, v_gross - v_bhxh - v_tax),
          'basis', 'monthly × worked_days/std − BHXH − tax', 'already_locked',
          exists(select 1 from public.staff_salary_runs sr where sr.staff_id = r.id and sr.period_year = p_year and sr.period_month = p_month and sr.status <> 'voided')));
      end;
    end if;
  end loop;

  return jsonb_build_object('club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
                            'standard_shifts_per_month', v_std, 'as_of', now(), 'staff', v_rows);
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
  -- A role/ownership change can commit while this request waits for the mutex.
  IF NOT public._staff_salary_authorised(v_uid,p_club_id) THEN RAISE EXCEPTION 'forbidden' USING errcode='42501';END IF;
  SELECT status INTO v_state FROM public.staff_salary_periods WHERE club_id=p_club_id AND period_year=p_year AND period_month=p_month FOR UPDATE;
  IF v_state IN ('submitted','approved') THEN
    RETURN jsonb_build_object('status','ok','club_id',p_club_id,'period_year',p_year,'period_month',p_month,'locked_now',0,
      'total_net_vnd',(SELECT coalesce(sum(net_vnd),0) FROM public.staff_salary_runs WHERE club_id=p_club_id AND period_year=p_year AND period_month=p_month AND status<>'voided'));
  END IF;
  v_std := coalesce((select standard_shifts_per_month from public.club_settings where club_id = p_club_id limit 1), 26);

  -- Inactive attendance needs an explicit end; never infer a departure cutoff.
  if exists (
    select 1 from public.staff s join public.staff_attendance a on a.staff_id=s.id
    where s.club_id=p_club_id and s.status='inactive' and s.deleted_at is null
      and s.employment_type='full_time' and a.shift_date>=v_from and a.shift_date<v_to
      and a.check_in_time is not null and a.check_out_time is null
      and not exists (select 1 from public.staff_salary_runs sr
        where sr.staff_id=s.id and sr.period_year=p_year and sr.period_month=p_month
          and sr.status<>'voided')
  ) then
    raise exception 'STAFF_INACTIVE_FT_ATTENDANCE_END_REQUIRED' using errcode='22023';
  end if;

  for r in
    select s.id, s.employment_type, s.monthly_salary_vnd, s.manual_bhxh_vnd, s.manual_tax_vnd
    from public.staff s
    where s.club_id = p_club_id and s.deleted_at is null
      and (s.status = 'active' or (
        s.status = 'inactive' and s.employment_type = 'full_time'
        and exists (select 1 from public.staff_attendance a
          where a.staff_id = s.id and a.shift_date >= v_from and a.shift_date < v_to
            and a.check_in_time is not null and a.check_out_time is not null)
      ))
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
