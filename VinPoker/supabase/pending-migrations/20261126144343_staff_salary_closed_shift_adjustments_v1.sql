-- Prospective completed-only FT policy; source proof stays private because legacy salary-row RLS is broader.
-- No UPDATE/backfill of legacy salary rows, no new public attendance column. Existing PT/payment/authority and month locks retained.
-- ROLLBACK: paired HOLD disables new freezes; preserve private evidence and compatible reads.
DO $guard$ BEGIN
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.get_staff_salary_month(uuid,integer,integer)'::regprocedure) NOT IN ('9f51edb60d2c6d8f6d156e24a3a26065','b56895ee64b7dd9ca135bcbb68c4b0b2') THEN RAISE EXCEPTION 'staff_salary_closed_shift_source_drift:get_staff_salary_month';END IF;
 IF (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid='public.chot_staff_salary_month(uuid,integer,integer)'::regprocedure) NOT IN ('a873268e75e5f6d9c6d236fb633c79b9','d72e3c7ff70ae385a9bab496f07f78dc','7dad1b76046e7b619e2abed115ee8ace') THEN RAISE EXCEPTION 'staff_salary_closed_shift_source_drift:chot_staff_salary_month';END IF;
 IF to_regprocedure('floor_private.staff_salary_source_v1(uuid,integer,integer,jsonb)') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_source_v1(uuid,integer,integer,jsonb)'))<>'ed56905e6cb978453f1913b7a3e3d044' THEN RAISE EXCEPTION 'staff_salary_closed_shift_helper_drift';END IF;
 IF to_regprocedure('floor_private.staff_salary_source_immutable_v1()') IS NOT NULL AND (SELECT md5(replace(prosrc,E'\r','')) FROM pg_proc WHERE oid=to_regprocedure('floor_private.staff_salary_source_immutable_v1()'))<>'9f20f1281230ebbb64c29ce65d739aa4' THEN RAISE EXCEPTION 'staff_salary_closed_shift_helper_drift';END IF;
END $guard$;
DO $storage_guard$ BEGIN
 IF to_regclass('floor_private.staff_salary_sources_v1') IS NOT NULL
 AND obj_description(to_regclass('floor_private.staff_salary_sources_v1'),'pg_class') IS DISTINCT FROM 'staff_salary_closed_source_v1_private' THEN
  RAISE EXCEPTION 'STAFF_SALARY_PRIVATE_SOURCE_STORAGE_UNKNOWN';END IF;
END $storage_guard$;
CREATE TABLE IF NOT EXISTS floor_private.staff_salary_sources_v1(
 run_id uuid PRIMARY KEY REFERENCES public.staff_salary_runs(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE floor_private.staff_salary_sources_v1 IS 'staff_salary_closed_source_v1_private';
ALTER TABLE floor_private.staff_salary_sources_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE floor_private.staff_salary_sources_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION floor_private.staff_salary_source_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $immutable$
DECLARE r public.staff_salary_runs%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'STAFF_SALARY_SOURCE_IMMUTABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.staff_salary_runs WHERE id=NEW.run_id;
 IF NOT FOUND OR r.adjusts_id IS NOT NULL OR r.employment_type<>'full_time'
 OR NEW.snapshot->>'version' IS DISTINCT FROM '1'
 OR (NEW.snapshot->>'staff_id')::uuid IS DISTINCT FROM r.staff_id
 OR (NEW.snapshot->>'club_id')::uuid IS DISTINCT FROM r.club_id
 OR (NEW.snapshot->>'period_year')::integer IS DISTINCT FROM r.period_year
 OR (NEW.snapshot->>'period_month')::integer IS DISTINCT FROM r.period_month
 OR (NEW.snapshot->>'gross_vnd')::bigint IS DISTINCT FROM r.gross_vnd
 OR (NEW.snapshot->>'net_vnd')::bigint IS DISTINCT FROM r.net_vnd
 OR (NEW.snapshot->>'completed_days')::integer IS DISTINCT FROM r.worked_days THEN
  RAISE EXCEPTION 'STAFF_SALARY_SOURCE_RUN_MISMATCH' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $immutable$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_source_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS staff_salary_source_immutable_v1 ON floor_private.staff_salary_sources_v1;
CREATE TRIGGER staff_salary_source_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON floor_private.staff_salary_sources_v1
FOR EACH ROW EXECUTE FUNCTION floor_private.staff_salary_source_immutable_v1();

CREATE OR REPLACE FUNCTION floor_private.staff_salary_source_v1(
 p_staff_id uuid,p_year integer,p_month integer,p_policy jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $source$
DECLARE
 s public.staff%ROWTYPE; rate bigint; standard_days integer; bhxh bigint; tax bigint;
 first_day date:=make_date(p_year,p_month,1); last_day date:=(make_date(p_year,p_month,1)+interval '1 month')::date;
 completed jsonb; pending jsonb; days integer; pending_days integer; gross bigint;
BEGIN
 SELECT * INTO s FROM public.staff WHERE id=p_staff_id AND deleted_at IS NULL;
 IF NOT FOUND OR s.employment_type<>'full_time' THEN
  RAISE EXCEPTION 'STAFF_SALARY_FT_SOURCE_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_policy IS NOT NULL AND (
  p_policy->>'version' IS DISTINCT FROM '1' OR (p_policy->>'staff_id')::uuid IS DISTINCT FROM s.id
  OR (p_policy->>'club_id')::uuid IS DISTINCT FROM s.club_id
  OR (p_policy->>'period_year')::integer IS DISTINCT FROM p_year
  OR (p_policy->>'period_month')::integer IS DISTINCT FROM p_month) THEN
  RAISE EXCEPTION 'STAFF_SALARY_SOURCE_SCOPE_MISMATCH' USING ERRCODE='22023';END IF;
 IF p_policy IS NULL THEN
  rate:=coalesce(s.monthly_salary_vnd,0);bhxh:=coalesce(s.manual_bhxh_vnd,0);tax:=coalesce(s.manual_tax_vnd,0);
  SELECT coalesce((SELECT standard_shifts_per_month FROM public.club_settings WHERE club_id=s.club_id LIMIT 1),26) INTO standard_days;
 ELSE
  rate:=(p_policy->>'monthly_salary_vnd')::bigint;
  standard_days:=(p_policy->>'standard_shifts_per_month')::integer;
  bhxh:=(p_policy->>'manual_bhxh_vnd')::bigint;tax:=(p_policy->>'manual_tax_vnd')::bigint;
 END IF;
 IF rate IS NULL OR rate<0 OR standard_days IS NULL OR standard_days<=0 OR bhxh IS NULL OR tax IS NULL THEN
  RAISE EXCEPTION 'STAFF_SALARY_POLICY_UNVERIFIED' USING ERRCODE='22023';END IF;
 WITH source AS (
  SELECT a.*,a.status='checked_out' AND a.check_in_time IS NOT NULL
    AND a.check_out_time IS NOT NULL AND a.check_out_time>=a.check_in_time
    AND a.check_out_time<=now() AS complete
  FROM public.staff_attendance a WHERE a.staff_id=s.id AND a.shift_date>=first_day AND a.shift_date<last_day
 ) SELECT coalesce(jsonb_agg(to_jsonb(source)-'complete' ORDER BY shift_date,id) FILTER(WHERE complete),'[]'::jsonb),
   coalesce(jsonb_agg(to_jsonb(source)-'complete' ORDER BY shift_date,id) FILTER(WHERE NOT coalesce(complete,false)),'[]'::jsonb),
   count(DISTINCT shift_date) FILTER(WHERE complete),
   count(DISTINCT shift_date) FILTER(WHERE NOT coalesce(complete,false))
  INTO completed,pending,days,pending_days FROM source;
 gross:=floor(rate::numeric*least(days,standard_days)/standard_days)::bigint;
 RETURN jsonb_build_object('version',1,'staff_id',s.id,'club_id',s.club_id,'period_year',p_year,'period_month',p_month,
  'monthly_salary_vnd',rate,'standard_shifts_per_month',standard_days,'manual_bhxh_vnd',bhxh,'manual_tax_vnd',tax,
  'completed_days',days,'pending_days',pending_days,'gross_vnd',gross,'net_vnd',greatest(0,gross-bhxh-tax),
  'attendance',completed,'pending_attendance',pending,'observed_at',now());
END $source$;
REVOKE ALL ON FUNCTION floor_private.staff_salary_source_v1(uuid,integer,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
      declare v_days int; v_gross bigint; v_bhxh bigint; v_tax bigint; v_source jsonb; v_new_run uuid; begin
        v_source:=floor_private.staff_salary_source_v1(r.id,p_year,p_month,
          jsonb_build_object('version',1,'staff_id',r.id,'club_id',p_club_id,'period_year',p_year,'period_month',p_month,
            'monthly_salary_vnd',coalesce(r.monthly_salary_vnd,0),'standard_shifts_per_month',v_std,
            'manual_bhxh_vnd',coalesce(r.manual_bhxh_vnd,0),'manual_tax_vnd',coalesce(r.manual_tax_vnd,0)));
        v_days:=(v_source->>'completed_days')::integer;
        v_gross:=(v_source->>'gross_vnd')::bigint;
        v_bhxh:=(v_source->>'manual_bhxh_vnd')::bigint;
        v_tax:=(v_source->>'manual_tax_vnd')::bigint;
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
$function$
;

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
      declare v_days int; v_gross bigint; v_bhxh bigint; v_tax bigint; v_source jsonb; v_new_run uuid; begin
        v_source:=floor_private.staff_salary_source_v1(r.id,p_year,p_month,
          jsonb_build_object('version',1,'staff_id',r.id,'club_id',p_club_id,'period_year',p_year,'period_month',p_month,
            'monthly_salary_vnd',coalesce(r.monthly_salary_vnd,0),'standard_shifts_per_month',v_std,
            'manual_bhxh_vnd',coalesce(r.manual_bhxh_vnd,0),'manual_tax_vnd',coalesce(r.manual_tax_vnd,0)));
        v_days:=(v_source->>'completed_days')::integer;
        v_gross:=(v_source->>'gross_vnd')::bigint;
        v_bhxh:=(v_source->>'manual_bhxh_vnd')::bigint;
        v_tax:=(v_source->>'manual_tax_vnd')::bigint;
        insert into public.staff_salary_runs (
          club_id, staff_id, period_year, period_month, employment_type,
          worked_days, gross_vnd, manual_bhxh_vnd, manual_tax_vnd, net_vnd, status, locked_by)
        values (p_club_id, r.id, p_year, p_month, 'full_time',
          v_days, v_gross, v_bhxh, v_tax, greatest(0, v_gross - v_bhxh - v_tax), 'locked', v_uid)
        on conflict do nothing RETURNING id INTO v_new_run;
        IF v_new_run IS NOT NULL THEN
          INSERT INTO floor_private.staff_salary_sources_v1(run_id,snapshot)
          VALUES(v_new_run,v_source||jsonb_build_object('frozen_at',now()));
        END IF;
      end;
    end if;
    v_locked := v_locked + 1;
  end loop;

  return jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
    'locked_now', v_locked,
    'total_net_vnd', (select coalesce(sum(net_vnd),0) from public.staff_salary_runs
                      where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided'));
end;
$function$
;
