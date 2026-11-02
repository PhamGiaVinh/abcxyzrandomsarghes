-- Exact elapsed microseconds; preserve scope, anchors, 24h-per-shift cap and floor semantics.
-- Source candidate only: no historical payment/snapshot rewrite and no ACL change.
DO $staff_pt318$ BEGIN IF to_regprocedure('public._staff_pt_wage_balance(uuid)') IS NULL OR md5(replace(pg_get_functiondef('public._staff_pt_wage_balance(uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'a0d3a9472b2f897373786edb3dc7312e' THEN RAISE EXCEPTION 'staff_pt318_requires_current_catalog_mismatch'; END IF; END $staff_pt318$;
CREATE OR REPLACE FUNCTION public._staff_pt_wage_balance(p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff      record;
  v_rate       integer;
  v_anchor     timestamptz;
  v_now        timestamptz := now();
  v_microseconds numeric := 0;
  v_wage_numerator numeric;
  v_open_start timestamptz;
begin
  select id, full_name, employment_type, hourly_rate_vnd, club_id
    into v_staff
  from public.staff
  where id = p_staff_id and status = 'active' and deleted_at is null;
  if not found then
    return jsonb_build_object('error', 'staff not found or inactive');
  end if;

  -- Rate = configured staff hourly rate (no implicit floor — owner sets it).
  v_rate := coalesce(v_staff.hourly_rate_vnd, 0);

  -- reset anchor = last non-voided payout covered_to, else first attendance, else now()
  select coalesce(
    (select max(covered_to) from public.staff_pt_wage_payments
       where staff_id = p_staff_id and voided_at is null),
    (select min(check_in_time) from public.staff_attendance
       where staff_id = p_staff_id and check_in_time is not null),
    v_now
  ) into v_anchor;

  -- accrued microseconds since anchor: per shift, overlap of [max(check_in,anchor), min(eff_out,now)]
  -- where eff_out = check_out OR now() (open shift accrues live). Cap each shift at 24h.
  select coalesce(sum(
           least(
             greatest(0, extract(epoch from (
               least(coalesce(sa.check_out_time, v_now), v_now)
               - greatest(sa.check_in_time, v_anchor)
             )) * 1000000),
             86400000000
           )
         ), 0)
    into v_microseconds
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id
    and sa.status in ('checked_in', 'checked_out')
    and sa.check_in_time is not null
    and sa.check_in_time < v_now
    and coalesce(sa.check_out_time, v_now) > v_anchor;

  -- Exact integer quotient avoids rounding recurring minute fractions before floor.
  v_wage_numerator := v_microseconds * v_rate;

  -- current open shift (client-side live tick)
  select sa.check_in_time into v_open_start
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id
    and sa.status = 'checked_in'
    and sa.check_out_time is null
    and sa.check_in_time is not null
  order by sa.check_in_time desc
  limit 1;

  return jsonb_build_object(
    'staff_id',            p_staff_id,
    'full_name',           v_staff.full_name,
    'employment_type',     v_staff.employment_type,
    'club_id',             v_staff.club_id,
    'hourly_rate_vnd',     v_rate,
    'accrued_minutes',     div(v_microseconds,60000000)::int,
    'balance_vnd',         (div(v_wage_numerator,3600000000) - CASE
      WHEN v_wage_numerator < 0 AND mod(v_wage_numerator,3600000000) <> 0 THEN 1
      ELSE 0 END)::bigint,
    'last_reset_at',       v_anchor,
    'current_shift_open',  (v_open_start is not null),
    'current_shift_start', v_open_start,
    'as_of',               v_now
  );
end;
$function$;
