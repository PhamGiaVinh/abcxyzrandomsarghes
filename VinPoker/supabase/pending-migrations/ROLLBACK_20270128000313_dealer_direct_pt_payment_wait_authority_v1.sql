-- Restore captured pre313 direct PT payer definition.
CREATE OR REPLACE FUNCTION public.pay_part_time_balance(p_dealer_id uuid, p_payment_method text, p_payment_reference text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor           uuid := auth.uid();
  v_dealer          record;
  v_key             text;
  v_prior           record;
  v_bal             jsonb;
  v_amount          bigint;
  v_minutes         integer;
  v_rate            integer;
  v_anchor          timestamptz;
  v_now             timestamptz := now();
  v_id              uuid;
  v_policy_snapshot jsonb;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, club_id, employment_type, status
    into v_dealer
  from public.dealers
  where id = p_dealer_id;
  if not found or v_dealer.status <> 'active' then
    raise exception 'Dealer not found or inactive' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'part_time' then
    raise exception 'Only part-time dealers are supported' using errcode = 'P0001';
  end if;
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = v_dealer.club_id and c.owner_id = v_actor)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = v_dealer.club_id and cc.user_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);
  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_dealer.club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || p_dealer_id::text));

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_prior
    from public.dealer_pt_wage_payments
    where dealer_id = p_dealer_id and idempotency_key = v_key
    limit 1;
    if found then
      return jsonb_build_object(
        'payment_id', v_prior.id,
        'idempotent', true,
        'amount_vnd', v_prior.amount_vnd,
        'minutes_paid', v_prior.minutes_paid,
        'covered_from', v_prior.covered_from,
        'covered_to', v_prior.covered_to,
        'paid_at', v_prior.paid_at,
        'accrual_policy_snapshot', v_prior.accrual_policy_snapshot
      );
    end if;
  end if;

  if exists (
    select 1 from public.dealer_pt_wage_settlements s
    where s.dealer_id = p_dealer_id and s.status = 'finalized'
  ) then
    raise exception 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' using errcode = 'P0001';
  end if;

  v_bal := public._pt_wage_balance(p_dealer_id);
  PERFORM floor_private.assert_pt_no_monthly_overlap_v1(p_dealer_id,coalesce(v_bal->'rate_segments','[]'::jsonb));
  v_amount := coalesce((v_bal->>'balance_vnd')::bigint, 0);
  v_minutes := coalesce((v_bal->>'accrued_minutes')::int, 0);
  v_rate := coalesce((v_bal->>'hourly_rate_vnd')::int, 0);
  v_anchor := coalesce((v_bal->>'last_reset_at')::timestamptz, v_now);
  v_policy_snapshot := jsonb_build_object(
    'accrual_mode', v_bal->>'accrual_mode',
    'standby_accrual_enabled', coalesce((v_bal->>'standby_accrual_enabled')::boolean, false),
    'policy_effective_from', v_bal->'policy_effective_from',
    'per_attendance_cap_minutes', v_bal->'per_attendance_cap_minutes',
    'rate_history_applied', coalesce((v_bal->>'rate_history_applied')::boolean, false),
    'rate_segments', coalesce(v_bal->'rate_segments', '[]'::jsonb)
  );
  if v_amount <= 0 then
    raise exception 'Balance is zero' using errcode = 'P0001';
  end if;

  insert into public.dealer_pt_wage_payments (
    dealer_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by,
    payment_method, payment_reference, idempotency_key, note, accrual_policy_snapshot
  ) values (
    p_dealer_id, v_dealer.club_id, v_amount, v_minutes, v_rate,
    v_anchor, v_now, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note, v_policy_snapshot
  ) returning id into v_id;

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_payments', v_id, v_dealer.club_id, 'INSERT',
    jsonb_build_object(
      'dealer_id', p_dealer_id, 'amount_vnd', v_amount,
      'minutes_paid', v_minutes, 'hourly_rate_vnd_snapshot', v_rate,
      'covered_from', v_anchor, 'covered_to', v_now,
      'payment_method', p_payment_method, 'payment_reference', p_payment_reference,
      'accrual_policy_snapshot', v_policy_snapshot
    ), v_actor, 'PT wage full payout and reset'
  );

  return jsonb_build_object(
    'payment_id', v_id, 'idempotent', false, 'amount_vnd', v_amount,
    'minutes_paid', v_minutes, 'covered_from', v_anchor, 'covered_to', v_now,
    'paid_at', v_now, 'accrual_policy_snapshot', v_policy_snapshot
  );
end;
$function$
;
