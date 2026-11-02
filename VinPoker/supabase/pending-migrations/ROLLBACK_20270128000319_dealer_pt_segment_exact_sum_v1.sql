-- Restore previous calculator definition only.
DO $dealer_pt319$ BEGIN ASSERT md5(replace(pg_get_functiondef('public._pt_wage_balance(uuid)'::regprocedure),chr(13),''))='5beccf8ee0255d65c4f23cea36e02fbd','dealer_pt319_catalog_mismatch';END $dealer_pt319$;
CREATE OR REPLACE FUNCTION public._pt_wage_balance(p_dealer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dealer                  record;
  v_rate                    integer;
  v_anchor                  timestamptz;
  v_now                     timestamptz := now();
  v_accrued_seconds         numeric := 0;
  v_amount_vnd              numeric := 0;
  v_first_pt_rate_history   timestamptz;
  v_latest_pt_eligible      boolean;
  v_open_start              timestamptz;
  v_open_attendance_id      uuid;
  v_open_eligible_seconds   numeric := 0;
  v_standby_accrual_enabled boolean := false;
  v_effective_from          timestamptz;
  v_current_shift_capped    boolean := false;
  v_attendance              record;
  v_rate_row                record;
  v_window_start            timestamptz;
  v_window_end              timestamptz;
  v_segment_start           timestamptz;
  v_segment_end             timestamptz;
  v_segment_seconds         numeric;
  v_segment_amount_vnd      numeric;
  v_attendance_seconds      numeric;
  v_cap_seconds             numeric := 1440 * 60;
  v_rate_segments           jsonb := '[]'::jsonb;
  v_reserved_through        timestamptz;
begin
  select id, full_name, employment_type, hourly_rate_vnd, club_id
    into v_dealer
  from public.dealers
  where id = p_dealer_id and status = 'active';
  if not found then
    return jsonb_build_object('error', 'dealer not found or inactive');
  end if;

  v_rate := greatest(coalesce(v_dealer.hourly_rate_vnd, 0), 50000);

  select min(h.effective_from) filter (where h.pt_eligible),
         (array_agg(h.pt_eligible order by h.effective_from desc, h.id desc))[1]
    into v_first_pt_rate_history, v_latest_pt_eligible
  from public.dealer_pt_wage_rate_history h
  where h.dealer_id = p_dealer_id;

  if v_dealer.employment_type = 'part_time'
     and (v_first_pt_rate_history is null or v_latest_pt_eligible is distinct from true) then
    raise exception 'PT_WAGE_RATE_HISTORY_UNAVAILABLE' using errcode = 'P0002';
  end if;

  select max(s.covered_to)
    into v_reserved_through
  from public.dealer_pt_wage_settlements s
  where s.dealer_id = p_dealer_id and s.status = 'finalized';

  select coalesce(
    (
      select max(anchor_time)
      from (
        select p.covered_to as anchor_time
        from public.dealer_pt_wage_payments p
        where p.dealer_id = p_dealer_id and p.voided_at is null
        union all
        select s.covered_to as anchor_time
        from public.dealer_pt_wage_settlements s
        where s.dealer_id = p_dealer_id and s.status = 'finalized'
      ) anchors
    ),
    (
      select min(check_in_time)
      from public.dealer_attendance
      where dealer_id = p_dealer_id and check_in_time is not null
    ),
    v_now
  ) into v_anchor;

  select p.standby_accrual_enabled, p.effective_from
    into v_standby_accrual_enabled, v_effective_from
  from public.dealer_pt_wage_accrual_policies p
  where p.club_id = v_dealer.club_id;

  v_standby_accrual_enabled := coalesce(v_standby_accrual_enabled, false);
  if not v_standby_accrual_enabled then
    v_effective_from := null;
  elsif v_effective_from is null then
    v_effective_from := v_now;
  end if;

  select da.id, da.check_in_time
    into v_open_attendance_id, v_open_start
  from public.dealer_attendance da
  where da.dealer_id = p_dealer_id
    and da.status = 'checked_in'
    and da.check_out_time is null
    and da.check_in_time is not null
  order by da.check_in_time desc
  limit 1;

  if v_first_pt_rate_history is not null then
    for v_attendance in
      select da.id,
             da.check_in_time,
             least(coalesce(da.check_out_time, v_now), v_now) as window_end
      from public.dealer_attendance da
      where da.dealer_id = p_dealer_id
        and da.status in ('checked_in', 'checked_out')
        and da.check_in_time is not null
        and da.check_in_time < v_now
      order by da.check_in_time, da.id
    loop
      v_window_start := greatest(
        v_attendance.check_in_time,
        v_anchor,
        v_first_pt_rate_history,
        case when v_standby_accrual_enabled then v_effective_from else '-infinity'::timestamptz end
      );
      v_window_end := v_attendance.window_end;
      v_attendance_seconds := 0;
      -- Cap is consumed by eligible hours in this attendance, including hours
      -- before a paid/reserved anchor. Reserving a snapshot cannot restart24h.
      IF NOT v_standby_accrual_enabled THEN
        SELECT least(v_cap_seconds,coalesce(sum(greatest(0,extract(epoch FROM (
          least(h.next_effective_from,v_window_start,v_attendance.window_end)
          - greatest(h.effective_from,v_attendance.check_in_time)
        )))),0)) INTO v_attendance_seconds
        FROM (
          SELECT rh.effective_from,rh.pt_eligible,
            lead(rh.effective_from,1,v_window_start) OVER(ORDER BY rh.effective_from,rh.id) AS next_effective_from
          FROM public.dealer_pt_wage_rate_history rh
          WHERE rh.dealer_id=p_dealer_id AND rh.effective_from<v_window_start
        ) h WHERE h.pt_eligible;
        IF v_attendance.id=v_open_attendance_id THEN
          v_open_eligible_seconds:=v_open_eligible_seconds+v_attendance_seconds;
        END IF;
      END IF;
      if v_window_end <= v_window_start then
        continue;
      end if;

      for v_rate_row in
        select h.effective_from,
               h.hourly_rate_vnd,
               h.pt_eligible,
               lead(h.effective_from, 1, v_window_end)
                 over (order by h.effective_from, h.id) as next_effective_from
        from public.dealer_pt_wage_rate_history h
        where h.dealer_id = p_dealer_id
          and h.effective_from < v_window_end
        order by h.effective_from, h.id
      loop
        v_segment_start := greatest(v_window_start, v_rate_row.effective_from);
        v_segment_end := least(v_window_end, v_rate_row.next_effective_from);
        if v_segment_end <= v_segment_start or not v_rate_row.pt_eligible then
          continue;
        end if;

        v_segment_seconds := extract(epoch from (v_segment_end - v_segment_start));
        if not v_standby_accrual_enabled then
          v_segment_seconds := least(
            v_segment_seconds,
            greatest(0, v_cap_seconds - v_attendance_seconds)
          );
          v_segment_end := v_segment_start + (v_segment_seconds * interval '1 second');
        end if;
        if v_segment_seconds <= 0 then
          continue;
        end if;

        v_segment_amount_vnd := v_segment_seconds * v_rate_row.hourly_rate_vnd / 3600;
        v_attendance_seconds := v_attendance_seconds + v_segment_seconds;
        v_accrued_seconds := v_accrued_seconds + v_segment_seconds;
        v_amount_vnd := v_amount_vnd + v_segment_amount_vnd;
        if v_attendance.id = v_open_attendance_id then
          v_open_eligible_seconds := v_open_eligible_seconds + v_segment_seconds;
        end if;

        v_rate_segments := v_rate_segments || jsonb_build_array(jsonb_build_object(
          'attendance_id', v_attendance.id,
          'segment_start', v_segment_start,
          'segment_end', v_segment_end,
          'hourly_rate_vnd', v_rate_row.hourly_rate_vnd,
          'elapsed_seconds', v_segment_seconds,
          'amount_vnd', v_segment_amount_vnd
        ));
      end loop;
    end loop;
  end if;

  v_current_shift_capped := v_open_start is not null
    and not v_standby_accrual_enabled
    and v_open_eligible_seconds >= v_cap_seconds;

  return jsonb_build_object(
    'dealer_id',                   p_dealer_id,
    'full_name',                   v_dealer.full_name,
    'employment_type',             v_dealer.employment_type,
    'club_id',                     v_dealer.club_id,
    'hourly_rate_vnd',             v_rate,
    'accrued_minutes',             floor(v_accrued_seconds / 60)::int,
    'balance_vnd',                 floor(v_amount_vnd)::bigint,
    'last_reset_at',               v_anchor,
    'reserved_through',            v_reserved_through,
    'current_shift_open',          (v_open_start is not null),
    'current_shift_start',         v_open_start,
    'accrual_mode',                case when v_standby_accrual_enabled then 'continuous_standby' else 'capped_24h' end,
    'standby_accrual_enabled',     v_standby_accrual_enabled,
    'policy_effective_from',       v_effective_from,
    'per_attendance_cap_minutes',  case when v_standby_accrual_enabled then null else 1440 end,
    'current_shift_cap_reached',   v_current_shift_capped,
    'live_accrual_active',         v_open_start is not null and not v_current_shift_capped,
    'first_pt_rate_history',       v_first_pt_rate_history,
    'rate_history_applied',        true,
    'rate_segments',               v_rate_segments,
    'as_of',                       v_now
  );
end;
$function$;
