-- Restore only the two definitions installed by317; refuse unrelated later changes.
DO $dealer_statement_317_backout$ BEGIN
 IF to_regprocedure('public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)') IS NULL OR md5(replace(pg_get_functiondef('public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure),chr(13),'')) IS DISTINCT FROM '716a1918d5afbcbe6b0ad46376ab43ff' THEN RAISE EXCEPTION 'dealer_statement_317_backout_pay_finalized_part_time_payroll_statement_catalog_mismatch'; END IF;
 IF to_regprocedure('public.void_dealer_payroll_statement(uuid,text)') IS NULL OR md5(replace(pg_get_functiondef('public.void_dealer_payroll_statement(uuid,text)'::regprocedure),chr(13),'')) IS DISTINCT FROM '30f6e5ca3a98047fde4655633f8288a8' THEN RAISE EXCEPTION 'dealer_statement_317_backout_void_dealer_payroll_statement_catalog_mismatch'; END IF;
END $dealer_statement_317_backout$;
CREATE OR REPLACE FUNCTION public.pay_finalized_part_time_payroll_statement(p_statement_id uuid, p_payment_method text, p_payment_reference text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_settlement public.dealer_pt_wage_settlements%rowtype;
  v_payment public.dealer_pt_wage_payments%rowtype;
  v_actor uuid;
  v_key text;
  v_payment_id uuid;
  v_now timestamptz := now();
begin
  if p_statement_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = p_statement_id
  for update;
  if not found or v_statement.statement_kind <> 'part_time_settlement' then
    raise exception 'PT_FINALIZED_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_actor := public._assert_dealer_payroll_statement_actor(v_statement.club_id);
  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_statement.club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || v_statement.dealer_id::text));
  -- Statement row remains locked; authority can change while either wage mutex waits.
  v_actor := public._assert_dealer_payroll_statement_actor(v_statement.club_id);


  select * into v_settlement
  from public.dealer_pt_wage_settlements
  where statement_id = p_statement_id
  for update;
  if not found then
    raise exception 'PT_FINALIZED_SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_settlement.status = 'paid' or v_statement.pt_wage_payment_id is not null then
    select * into v_payment
    from public.dealer_pt_wage_payments
    where id = coalesce(v_settlement.payment_id, v_statement.pt_wage_payment_id)
    limit 1;
    if not found then
      raise exception 'PT_FINALIZED_STATEMENT_PAYMENT_LINK_BROKEN' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'statement_id', p_statement_id, 'payment_id', v_payment.id,
      'amount_vnd', v_payment.amount_vnd, 'idempotent', true
    );
  end if;
  if v_statement.state not in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
     or v_settlement.status <> 'finalized' then
    raise exception 'PT_FINALIZED_STATEMENT_NOT_PAYABLE' using errcode = 'P0001';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_payment
    from public.dealer_pt_wage_payments
    where dealer_id = v_statement.dealer_id and idempotency_key = v_key
    limit 1;
    if found then
      if v_payment.statement_id <> p_statement_id then
        raise exception 'PT_FINALIZED_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'statement_id', p_statement_id, 'payment_id', v_payment.id,
        'amount_vnd', v_payment.amount_vnd, 'idempotent', true
      );
    end if;
  end if;

  -- Retain paid/idempotent replay above; block only a new duplicate cash liability.
  PERFORM floor_private.assert_pt_no_monthly_overlap_v1(v_statement.dealer_id,
    CASE WHEN jsonb_typeof(v_statement.source_snapshot->'rate_segments')='array' AND jsonb_array_length(v_statement.source_snapshot->'rate_segments')>0 THEN v_statement.source_snapshot->'rate_segments' ELSE
      jsonb_build_array(jsonb_build_object('segment_start',v_settlement.covered_from,'segment_end',v_settlement.covered_to)) END);
  insert into public.dealer_pt_wage_payments (
    dealer_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by, payment_method,
    payment_reference, idempotency_key, note, accrual_policy_snapshot, statement_id
  ) values (
    v_settlement.dealer_id, v_settlement.club_id, v_settlement.amount_vnd,
    v_settlement.minutes_reserved, v_settlement.hourly_rate_vnd_snapshot,
    v_settlement.covered_from, v_settlement.covered_to, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note,
    v_settlement.accrual_policy_snapshot, p_statement_id
  ) returning id into v_payment_id;

  update public.dealer_pt_wage_settlements
  set status = 'paid', payment_id = v_payment_id
  where id = v_settlement.id;
  update public.dealer_payroll_statements
  set pt_wage_payment_id = v_payment_id
  where id = p_statement_id;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_pt_wage_payments', v_payment_id, v_settlement.club_id, 'INSERT',
    jsonb_build_object('statement_id', p_statement_id, 'amount_vnd', v_settlement.amount_vnd, 'covered_from', v_settlement.covered_from, 'covered_to', v_settlement.covered_to),
    v_actor, 'PT wage payment from finalized immutable statement snapshot'
  );

  return jsonb_build_object(
    'statement_id', p_statement_id, 'payment_id', v_payment_id,
    'amount_vnd', v_settlement.amount_vnd, 'idempotent', false
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.void_dealer_payroll_statement(p_statement_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_settlement public.dealer_pt_wage_settlements%rowtype;
  v_actor uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_period_status text;
begin
  if p_statement_id is null or v_reason is null then
    raise exception 'PAYROLL_STATEMENT_VOID_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = p_statement_id
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_actor := public._assert_dealer_payroll_statement_actor(v_statement.club_id);

  if v_statement.state not in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
     or v_statement.pt_wage_payment_id is not null then
    raise exception 'PAYROLL_STATEMENT_ALREADY_PAID_OR_NOT_VOIDABLE' using errcode = 'P0001';
  end if;

  if v_statement.statement_kind = 'full_time_period' then
    select status into v_period_status
    from public.payroll_periods
    where id = v_statement.payroll_period_id
    for update;
    if v_period_status <> 'locked' then
      raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' using errcode = 'P0001';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_statement.club_id::text));
    perform pg_advisory_xact_lock(hashtext('pt_wage:' || v_statement.dealer_id::text));
    select * into v_settlement
    from public.dealer_pt_wage_settlements
    where statement_id = p_statement_id
    for update;
    if not found or v_settlement.status <> 'finalized' or v_settlement.payment_id is not null then
      raise exception 'PT_FINALIZED_STATEMENT_ALREADY_PAID' using errcode = 'P0001';
    end if;
    update public.dealer_pt_wage_settlements
    set status = 'voided', voided_at = now(), voided_by = v_actor, void_reason = v_reason
    where id = v_settlement.id;
  end if;

  update public.dealer_payroll_statements
  set state = 'voided', voided_at = now(), voided_by = v_actor, void_reason = v_reason
  where id = p_statement_id;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, old_values, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', p_statement_id, v_statement.club_id, 'UPDATE',
    jsonb_build_object('state', v_statement.state),
    jsonb_build_object('state', 'voided'), v_actor, v_reason
  );

  return jsonb_build_object('statement_id', p_statement_id, 'state', 'voided');
end;
$function$
;
