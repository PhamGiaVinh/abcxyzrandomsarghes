-- Owner finance uses UTC+7 business calendar regardless of caller/session TimeZone.
-- Function-local setting covers month buckets and date-only payroll overlap; no history rewrite.
-- Dealer payroll rejection does not settle or void accrued saved wages.
-- Keep the existing rejected status and payment gate; include the amount in unpaid and aging.
-- Read-only Owner finance correction: locked STAFF FT wages remain unpaid after report rejection.
-- Rejection does not pay/void the frozen run. Keep rejected status and existing payment approval gate.
-- Dealer classifications, booked cost, F&B refunds and historical facts are unchanged.
DO $prerequisite$ BEGIN IF pg_catalog.to_regprocedure('floor_private.fnb_cancel_cogs_reversal_v1(uuid,bigint,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION 'staff_salary_307_requires_304_finance_basis';END IF;END $prerequisite$;
CREATE OR REPLACE FUNCTION public.get_club_finance_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET TimeZone TO 'Asia/Ho_Chi_Minh'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];
  v_club_ids uuid[];
  v_archive_default constant numeric := 199000;
  v_result jsonb;
  v_tour_receipts jsonb;
  v_staff_live jsonb;
  v_staff_year integer := extract(year from now() at time zone 'Asia/Ho_Chi_Minh');
  v_staff_month integer := extract(month from now() at time zone 'Asia/Ho_Chi_Minh');
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.user_roles ur where ur.user_id = v_uid and ur.role = 'super_admin'
  ) into v_super;

  if v_super then
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs;
  else
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs where owner_id = v_uid;
    -- [ACCT] accountant read scope: clubs where the caller is a club_accountants
    -- member join the owner-scope union (read-only P&L; RPC path only).
    select v_all_ids || coalesce(array_agg(ca.club_id), '{}') into v_all_ids
    from public.club_accountants ca
    where ca.user_id = v_uid and not (ca.club_id = any(v_all_ids));
  end if;

  if p_club_id is not null then
    if not (p_club_id = any(v_all_ids)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_club_ids := array[p_club_id];
  else
    v_club_ids := v_all_ids;
  end if;

  if v_all_ids is null or array_length(v_all_ids, 1) is null then
    return jsonb_build_object(
      'revenue', jsonb_build_object(
        'stakingFees',0,'stakingFixed',0,'stakingPercent',0,'stakingArchive',0,'payoutFees',0,
        'rake',0,'rakeActual',0,'rakeExpected',0,'rakeVariance',0,
        'rakeOnline',0,'rakeOffline',0,'rakeReentry',0,'serviceFee',0,'fnb',0,'total',0),
      'cost', jsonb_build_object(
        'payrollNet',0,'payrollGross',0,'adjustments',0,'ptWagePaid',0,'fnbCogs',0,'compCogs',0,'clubExpenses',0),  -- [C] +compCogs [PT] +ptWagePaid [EXP] +clubExpenses
      'net', 0, 'statusTotals', '{}'::jsonb, 'unpaidTotal', 0, 'reconciledTotal', 0,
      'aging', jsonb_build_object('d0_30',0,'d31_60',0,'d61_90',0,'d90p',0),
      'trend', '[]'::jsonb, 'perPeriod', '[]'::jsonb, 'perClub', '[]'::jsonb, 'clubs', '[]'::jsonb,
      'staffLive',jsonb_build_object('scope','current_outstanding','asOf',now(),'timeZone','Asia/Ho_Chi_Minh',
        'ftPeriod',v_staff_year::text||'-'||lpad(v_staff_month::text,2,'0'),
        'ftProvisionalGross',0,'ftProvisionalNet',0,'ptUnpaidBalance',0)
    );
  end if;

  -- Collect once through the SAME classifier used by live and buy-close.
  select coalesce(jsonb_agg(receipt), '[]'::jsonb) into v_tour_receipts
  from unnest(v_club_ids) cid
  cross join lateral jsonb_array_elements(floor_private.tour_revenue_live_source_v1(cid)->'tours') receipt;

  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.start_time is null and (
      (receipt->>'unavailableBuys')::bigint>0
      or (receipt->>'rake')::numeric<>0 or (receipt->>'serviceFee')::numeric<>0)) then
    raise exception 'finance_report_event_start_unavailable' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.start_time between p_from and p_to and (receipt->>'unavailableBuys')::bigint>0) then
    raise exception 'finance_report_receipt_price_unavailable' using errcode='22023';
  end if;

  with
  acc_clubs as (
    select id, name from public.clubs where id = any(v_all_ids)
  ),
  fee_rows as (
    select d.club_id, to_char(d.created_at, 'YYYY-MM') as ym,
      ( case when d.player_checked_in and coalesce(d.platform_fixed_fee,0) > 0 then coalesce(d.platform_fixed_fee,0) else 0 end ) as fixed_fee,
      ( case when d.player_checked_in and coalesce(d.platform_percent_fee,0) > 0 then coalesce(d.platform_percent_fee,0) else 0 end ) as percent_fee,
      ( case when d.status = 'completed' and coalesce(d.result_prize_vnd,0) > 0
             then least(coalesce(d.platform_archive_fee, v_archive_default), coalesce(d.result_prize_vnd,0)) else 0 end ) as archive_fee
    from public.staking_deals d
    where d.club_id = any(v_club_ids) and d.created_at between p_from and p_to
  ),
  payout_rows as (
    select d.club_id, to_char(pr.created_at, 'YYYY-MM') as ym, coalesce(pr.platform_fee_vnd,0) as fee
    from public.payout_recipients pr
    join public.staking_deals d on d.id = pr.deal_id
    where d.club_id = any(v_club_ids) and pr.created_at between p_from and p_to
  ),
  -- cfg_* column names remain for API compatibility; values are now the
  -- accepted receipt allocation, not a calculation from current tour config.
  rake_cfg as (
    select t.club_id,to_char(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') as ym,
      (receipt->>'rakeOnline')::numeric as cfg_online,
      (receipt->>'rakeOffline')::numeric as cfg_offline,
      (receipt->>'rakeReentry')::numeric as cfg_reentry,
      (receipt->>'serviceFee')::numeric as cfg_service,
      (receipt->>'rake')::numeric as actual_sum
    from jsonb_array_elements(v_tour_receipts) receipt
    join public.tournaments t on t.id=(receipt->>'tournamentId')::uuid
    where t.club_id=any(v_club_ids) and t.start_time between p_from and p_to
  ),
  -- [C] fnb_rows: REGULAR paid sales only — comps excluded (NOT COALESCE(o.is_comp,false)).
  --     The same per-club fnb_settings JOIN as before.
  fnb_rows as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           o.subtotal_vnd::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.paid_at is not null
      and o.paid_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comps from the regular sales COGS
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           -o.subtotal_vnd::numeric as revenue,
           -floor_private.fnb_cancel_cogs_reversal_v1(o.id,o.cogs_vnd,o.shipped_at) as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comp cancels (handled in fnb_rows_comp)
  ),
  -- [C] fnb_rows_comp: comp-order COGS only, event-time (rev=0 always; cogs=real ingredient cost).
  --     SALE at paid_at; CANCEL reverses COGS if not yet shipped (same rule as regular cancel).
  --     Same per-club gate (fnb_settings.fnb_in_club_net). EMPTY when flag off → golden-diff holds.
  fnb_rows_comp as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           0::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.paid_at is not null and o.paid_at between p_from and p_to
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           0::numeric as revenue,
           -floor_private.fnb_cancel_cogs_reversal_v1(o.id,o.cogs_vnd,o.shipped_at) as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
  ),
  rev_all as (
    select club_id, ym, (fixed_fee + percent_fee + archive_fee) as fee from fee_rows
    union all select club_id, ym, fee from payout_rows
    union all select club_id, ym, (cfg_online + cfg_offline + cfg_reentry + cfg_service) as fee from rake_cfg
    union all select club_id, ym, revenue as fee from fnb_rows
    -- [C] fnb_rows_comp.revenue is 0 so omitting from rev_all is equivalent — cleaner.
  ),
  period_agg as (
    select pp.id as period_id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
      pp.status as period_status, pp.locked_at, pp.approved_at, pp.submitted_at,
      coalesce(sum(dp.net_pay_vnd)   filter (where coalesce(dp.status,'') <> 'excluded'), 0) as net,
      coalesce(sum(dp.gross_pay_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as gross,
      coalesce(sum(dp.total_adjustments_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as adj
    from public.payroll_periods pp
    left join public.dealer_payroll dp on dp.period_id = pp.id
    where pp.club_id = any(v_club_ids)
      and pp.period_start <= p_to::date and pp.period_end >= p_from::date
    group by pp.id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
             pp.status, pp.locked_at, pp.approved_at, pp.submitted_at
  ),
  pay as (
    select distinct on (pr.period_id) pr.period_id, pr.status as pay_status,
      pr.paid_at, pr.reconciled_at, pr.prepared_at
    from public.payment_records pr
    where pr.club_id = any(v_club_ids)
    order by pr.period_id, pr.created_at desc
  ),
  period_eff as (
    select pa.period_id, pa.club_id, pa.period_year, pa.period_month, pa.net, pa.gross, pa.adj,
      case
        when py.reconciled_at is not null or py.pay_status = 'reconciled' then 'reconciled'
        when py.paid_at is not null or py.pay_status = 'paid' then 'paid'
        when py.prepared_at is not null or py.pay_status in ('prepared','payment_prepared') then 'payment_prepared'
        when lower(coalesce(pa.period_status,'')) in
             ('draft','submitted','approved','locked','rejected','payment_prepared','paid','reconciled')
          then lower(pa.period_status)
        else 'other'
      end as eff_status,
      coalesce(py.prepared_at, pa.locked_at, pa.approved_at, pa.submitted_at, pa.period_end::timestamptz) as unpaid_anchor
    from period_agg pa
    left join pay py on py.period_id = pa.period_id
  ),
  -- STAFF FT: read immutable monthly runs, never recalculate settled history.
  -- Same overlap-period convention as dealer monthly payroll, explicit club timezone.
  -- Staff PT monthly runs are summaries of already-paid cash and MUST NOT enter here.
  staff_ft as (
    select r.club_id,r.period_year,r.period_month,r.net_vnd as net,r.gross_vnd as gross,
      0::numeric as adj,
      case when r.status='paid' then 'paid'
           when p.status in ('submitted','approved','rejected') then p.status
           else 'locked' end as eff_status,
      r.locked_at as unpaid_anchor
    from public.staff_salary_runs r
    left join public.staff_salary_periods p on p.club_id=r.club_id
      and p.period_year=r.period_year and p.period_month=r.period_month
    where r.club_id=any(v_club_ids) and r.employment_type='full_time'
      and r.status in ('locked','paid')
      and make_date(r.period_year,r.period_month,1)<=(p_to at time zone 'Asia/Ho_Chi_Minh')::date
      and (make_date(r.period_year,r.period_month,1)+interval '1 month')::date>(p_from at time zone 'Asia/Ho_Chi_Minh')::date
  ),
  payroll_cost as (
    select club_id,period_year,period_month,net,gross,adj,eff_status,unpaid_anchor,false as is_staff_ft from period_eff
    union all
    select club_id,period_year,period_month,net,gross,adj,eff_status,unpaid_anchor,true as is_staff_ft from staff_ft
  ),
  -- [PT] Option B (restored from 20261028000001 v4): PART-TIME wage payouts are real cash that does
  --      NOT flow through payment_records; summed into payroll cost on a CASH basis (by paid_at,
  --      non-voided). Dropped by the fnb finance rewrites (…000006/…000011/…000013) — restored here.
  pt_pay as (
    select w.club_id, to_char(w.paid_at, 'YYYY-MM') as ym, w.amount_vnd as amt
    from public.dealer_pt_wage_payments w
    where w.club_id = any(v_club_ids)
      and w.voided_at is null
      and w.paid_at between p_from and p_to
    union all
    select w.club_id,to_char(w.paid_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'),w.amount_vnd
    from public.staff_pt_wage_payments w
    where w.club_id=any(v_club_ids) and w.voided_at is null
      and w.paid_at between p_from and p_to
  ),
  -- [EXP] Club operating expenses (rent/utilities/marketing/…): real cash cost from the append-only
  --       club_expenses ledger. amount_vnd is SIGNED (adjustment rows net out). By incurred_at,
  --       between p_from and p_to — same closed-interval basis as pt_pay / fee_rows.
  club_exp as (
    select e.club_id, to_char(e.incurred_at, 'YYYY-MM') as ym, e.amount_vnd as amt
    from public.club_expenses e
    where e.club_id = any(v_club_ids)
      and e.incurred_at between p_from and p_to
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'stakingFees',    (select coalesce(sum(fixed_fee + percent_fee + archive_fee),0) from fee_rows),
      'stakingFixed',   (select coalesce(sum(fixed_fee),0)   from fee_rows),
      'stakingPercent', (select coalesce(sum(percent_fee),0) from fee_rows),
      'stakingArchive', (select coalesce(sum(archive_fee),0) from fee_rows),
      'payoutFees',     (select coalesce(sum(fee),0) from payout_rows),
      'rake',           (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeActual',     (select coalesce(sum(actual_sum),0) from rake_cfg),
      'rakeExpected',   (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeVariance',   (select coalesce(sum(actual_sum),0) from rake_cfg)
                        - (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeOnline',     (select coalesce(sum(cfg_online),0)  from rake_cfg),
      'rakeOffline',    (select coalesce(sum(cfg_offline),0) from rake_cfg),
      'rakeReentry',    (select coalesce(sum(cfg_reentry),0) from rake_cfg),
      'serviceFee',     (select coalesce(sum(cfg_service),0) from rake_cfg),
      'fnb',            (select coalesce(sum(revenue),0) from fnb_rows),
      'total',          (select coalesce(sum(fee),0) from rev_all)
    ),
    'cost', jsonb_build_object(
      -- [PT] payrollNet INCLUDES PT payouts (Option B). ptWagePaid is the itemized PT sub-total
      --      (already inside payrollNet — do NOT add again in the client).
      'payrollNet',   (select coalesce(sum(net),0)   from payroll_cost) + (select coalesce(sum(amt),0) from pt_pay),
      'payrollGross', (select coalesce(sum(gross),0) from payroll_cost),
      'adjustments',  (select coalesce(sum(adj),0)   from payroll_cost),
      'ptWagePaid',   (select coalesce(sum(amt),0)   from pt_pay),
      'fnbCogs',      (select coalesce(sum(cogs),0)  from fnb_rows),           -- regular sales COGS only
      'compCogs',     (select coalesce(sum(cogs),0)  from fnb_rows_comp),        -- [C] comp COGS (separate line)
      'clubExpenses', (select coalesce(sum(amt),0)   from club_exp)              -- [EXP] operating expenses (rent/utilities/…)
    ),
    -- [C] net deducts BOTH regular COGS and comp COGS (owner decision: comp is a real cost).
    -- [PT] and deducts PT wage payouts (restored).
    'net', (select coalesce(sum(fee),0) from rev_all)
           - (select coalesce(sum(net),0) from payroll_cost)
           - (select coalesce(sum(amt),0) from pt_pay)
           - (select coalesce(sum(cogs),0) from fnb_rows)
           - (select coalesce(sum(cogs),0) from fnb_rows_comp)
           - (select coalesce(sum(amt),0) from club_exp),   -- [EXP] deduct operating expenses
    'statusTotals', (
      select coalesce(jsonb_object_agg(eff_status, total), '{}'::jsonb)
      from (select eff_status, sum(net) as total from payroll_cost group by eff_status) s
    ),
    'unpaidTotal', (select coalesce(sum(net),0) from payroll_cost
                    where (eff_status in ('submitted','approved','locked','payment_prepared') OR eff_status='rejected')),
    'reconciledTotal', (select coalesce(sum(net),0) from payroll_cost where eff_status = 'reconciled'),
    'aging', (
      select jsonb_build_object(
        'd0_30',  coalesce(sum(net) filter (where days <= 30), 0),
        'd31_60', coalesce(sum(net) filter (where days > 30 and days <= 60), 0),
        'd61_90', coalesce(sum(net) filter (where days > 60 and days <= 90), 0),
        'd90p',   coalesce(sum(net) filter (where days > 90), 0)
      )
      from (
        select net, greatest(0, floor(extract(epoch from (now() - unpaid_anchor)) / 86400))::int as days
        from payroll_cost
        where (eff_status in ('submitted','approved','locked','payment_prepared') OR eff_status='rejected')
      ) a
    ),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', to_char(to_date(ym, 'YYYY-MM'), 'MM/YY'), 'revenue', rev_v, 'cost', cost_v
      ) order by ym), '[]'::jsonb)
      from (
        select m.ym,
          coalesce((select sum(fee) from rev_all r where r.ym = m.ym), 0) as rev_v,
          -- [C] cost_v now includes both regular and comp COGS
          coalesce((select sum(net) from payroll_cost pe
                    where to_char(make_date(pe.period_year, pe.period_month, 1), 'YYYY-MM') = m.ym), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.ym = m.ym), 0)              -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.ym = m.ym), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.ym = m.ym), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.ym = m.ym), 0) as cost_v  -- [EXP]
        from (
          select ym from rev_all
          union select to_char(make_date(period_year, period_month, 1), 'YYYY-MM') as ym from payroll_cost
          union select ym from pt_pay           -- [PT] PT months into the spine
          union select ym from fnb_rows
          union select ym from fnb_rows_comp    -- [C] comp months into the spine
          union select ym from club_exp         -- [EXP] expense months into the spine
        ) m
      ) t
    ),
    'perPeriod', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pe.period_id, 'clubId', pe.club_id,
        'clubName', coalesce((select name from acc_clubs ac where ac.id = pe.club_id), '—'),
        'periodKey', lpad(pe.period_month::text, 2, '0') || '/' || pe.period_year::text,
        'gross', pe.gross, 'net', pe.net, 'status', pe.eff_status
      ) order by pe.period_year desc, pe.period_month desc), '[]'::jsonb)
      from period_eff pe
    ),
    'perClub', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'clubId', cid, 'name', cname, 'revenue', rev_v, 'cost', cost_v, 'net', rev_v - cost_v
      ) order by (rev_v - cost_v) desc), '[]'::jsonb)
      from (
        select ac.id as cid, ac.name as cname,
          coalesce((select sum(fee) from rev_all r where r.club_id = ac.id), 0) as rev_v,
          coalesce((select sum(net) from payroll_cost pe where pe.club_id = ac.id), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.club_id = ac.id), 0)                    -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.club_id = ac.id), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.club_id = ac.id), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.club_id = ac.id), 0) as cost_v        -- [EXP]
        from acc_clubs ac
        where ac.id = any(v_club_ids)
      ) pc
      where rev_v <> 0 or cost_v <> 0
    ),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from acc_clubs)
  ) into v_result;

  -- Current outstanding is an explicitly separate clock/scope from the selected
  -- historical P&L range. Reuse canonical salary rules; never fabricate a second
  -- payroll calculator or recalculate/overwrite saved monthly runs.
  with preview_clubs as (
    select cid from unnest(v_club_ids) cid
    where not exists(select 1 from public.staff_salary_periods p
      where p.club_id=cid and p.period_year=v_staff_year and p.period_month=v_staff_month)
      and not exists(select 1 from public.staff_salary_runs r
        where r.club_id=cid and r.period_year=v_staff_year and r.period_month=v_staff_month
          and r.status<>'voided')
  ), ft_preview as (
    select row_data from preview_clubs c
    cross join lateral jsonb_array_elements(public.get_staff_salary_month(c.cid,v_staff_year,v_staff_month)->'staff') row_data
    where row_data->>'employment_type'='full_time'
  ), pt_live as (
    select public._staff_pt_wage_balance(s.id) as balance
    from public.staff s where s.club_id=any(v_club_ids)
      and s.employment_type='part_time' and s.status='active' and s.deleted_at is null
  )
  select jsonb_build_object(
    'scope','current_outstanding','asOf',now(),'timeZone','Asia/Ho_Chi_Minh',
    'ftPeriod',v_staff_year::text||'-'||lpad(v_staff_month::text,2,'0'),
    'ftProvisionalGross',(select coalesce(sum((row_data->>'gross_vnd')::bigint),0) from ft_preview),
    'ftProvisionalNet',(select coalesce(sum((row_data->>'net_vnd')::bigint),0) from ft_preview),
    'ptUnpaidBalance',(select coalesce(sum((balance->>'balance_vnd')::bigint),0) from pt_live)
  ) into v_staff_live;

  return v_result||jsonb_build_object('staffLive',v_staff_live);
end;
$function$;
