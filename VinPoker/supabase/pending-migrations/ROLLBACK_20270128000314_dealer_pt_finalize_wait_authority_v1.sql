-- Exact captured pre314 finalization definition.
CREATE OR REPLACE FUNCTION public.finalize_part_time_payroll_statement(p_request_id uuid, p_club_id uuid, p_dealer_id uuid, p_reason text DEFAULT NULL::text, p_replaces_statement_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_actor uuid;
  v_dealer public.dealers%rowtype;
  v_club public.clubs%rowtype;
  v_existing public.dealer_payroll_statements%rowtype;
  v_replaced public.dealer_payroll_statements%rowtype;
  v_balance jsonb;
  v_rate_segments jsonb;
  v_source jsonb;
  v_dealer_snapshot jsonb;
  v_club_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_payload jsonb;
  v_statement_id uuid;
  v_settlement_id uuid;
  v_amount bigint;
  v_minutes integer;
  v_rate integer;
  v_anchor timestamptz;
  v_cutoff timestamptz;
  v_reason text := nullif(btrim(p_reason), '');
  v_segment jsonb;
  v_line_no integer := 0;
begin
  if p_request_id is null or p_club_id is null or p_dealer_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  v_actor := public._assert_dealer_payroll_statement_actor(p_club_id);

  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || p_club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || p_dealer_id::text));

  select * into v_existing
  from public.dealer_payroll_statements
  where club_id = p_club_id and request_id = p_request_id
  for update;
  if found then
    if v_existing.statement_kind <> 'part_time_settlement'
       or v_existing.dealer_id <> p_dealer_id then
      raise exception 'PAYROLL_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'statement_id', v_existing.id,
      'state', v_existing.state,
      'net_amount_vnd', v_existing.net_amount_vnd,
      'statement_hash', v_existing.statement_hash,
      'idempotent', true
    );
  end if;

  select * into v_dealer
  from public.dealers
  where id = p_dealer_id and club_id = p_club_id and status = 'active'
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'part_time' then
    raise exception 'PAYROLL_STATEMENT_NOT_PART_TIME_DEALER' using errcode = 'P0001';
  end if;

  perform 1
  from public.dealer_pt_wage_settlements s
  where s.dealer_id = p_dealer_id and s.status = 'finalized'
  for update;
  if found then
    raise exception 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' using errcode = 'P0001';
  end if;

  select * into v_club from public.clubs where id = p_club_id for share;
  if not found then
    raise exception 'PAYROLL_STATEMENT_CLUB_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_balance := public._pt_wage_balance(p_dealer_id);
  PERFORM floor_private.assert_pt_no_monthly_overlap_v1(p_dealer_id,coalesce(v_balance->'rate_segments','[]'::jsonb));
  if v_balance ? 'error' then
    raise exception 'PT_WAGE_BALANCE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_amount := coalesce(nullif(v_balance->>'balance_vnd', '')::bigint, 0);
  v_minutes := coalesce(nullif(v_balance->>'accrued_minutes', '')::integer, 0);
  v_rate := coalesce(nullif(v_balance->>'hourly_rate_vnd', '')::integer, 0);
  v_anchor := nullif(v_balance->>'last_reset_at', '')::timestamptz;
  v_cutoff := nullif(v_balance->>'as_of', '')::timestamptz;
  v_rate_segments := coalesce(v_balance->'rate_segments', '[]'::jsonb);
  if v_amount <= 0 or v_anchor is null or v_cutoff is null or v_cutoff < v_anchor
     or jsonb_typeof(v_rate_segments) <> 'array'
     or jsonb_array_length(v_rate_segments) = 0 then
    raise exception 'PT_WAGE_FINALIZATION_SNAPSHOT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_source := jsonb_build_object(
    'source_kind', 'part_time_effective_dated_balance',
    'cutoff_at', v_cutoff,
    'covered_from', v_anchor,
    'covered_to', v_cutoff,
    'balance', v_balance,
    'rate_segments', v_rate_segments
  );
  v_dealer_snapshot := jsonb_build_object(
    'dealer_id', v_dealer.id,
    'full_name', v_dealer.full_name,
    'employment_type', v_dealer.employment_type,
    'department', 'Dealer'
  );
  v_club_snapshot := jsonb_build_object(
    'club_id', v_club.id,
    'club_name', v_club.name,
    'brand_key', 'vinpoker',
    'brand_asset_version', 'v1'
  );
  v_financial_snapshot := jsonb_build_object(
    'currency', 'VND',
    'gross_amount_vnd', v_amount,
    'deduction_amount_vnd', 0,
    'net_amount_vnd', v_amount,
    'net_amount_source', 'server_finalized_pt_rate_segments',
    'minutes_reserved', v_minutes,
    'hourly_rate_vnd_snapshot', v_rate,
    'accrual_policy_snapshot', jsonb_build_object(
      'accrual_mode', v_balance->>'accrual_mode',
      'standby_accrual_enabled', v_balance->'standby_accrual_enabled',
      'policy_effective_from', v_balance->'policy_effective_from',
      'per_attendance_cap_minutes', v_balance->'per_attendance_cap_minutes',
      'rate_history_applied', v_balance->'rate_history_applied',
      'rate_segments', v_rate_segments
    )
  );
  v_payload := jsonb_build_object(
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot
  );

  if p_replaces_statement_id is not null then
    select * into v_replaced
    from public.dealer_payroll_statements
    where id = p_replaces_statement_id
    for update;
    if not found
       or v_replaced.state <> 'voided'
       or v_replaced.club_id <> p_club_id
       or v_replaced.dealer_id <> p_dealer_id
       or v_replaced.statement_kind <> 'part_time_settlement' then
      raise exception 'PAYROLL_STATEMENT_REPLACEMENT_INVALID' using errcode = 'P0001';
    end if;
  end if;

  insert into public.dealer_payroll_statements (
    club_id, dealer_id, statement_kind, state, request_id, cutoff_at,
    replaces_statement_id, gross_amount_vnd, deduction_amount_vnd, net_amount_vnd,
    source_snapshot, dealer_snapshot, club_snapshot, financial_snapshot,
    source_fingerprint, statement_hash, finalized_by
  ) values (
    p_club_id, p_dealer_id, 'part_time_settlement', 'finalized', p_request_id, v_cutoff,
    p_replaces_statement_id, v_amount, 0, v_amount,
    v_source, v_dealer_snapshot, v_club_snapshot, v_financial_snapshot,
    public._dealer_payroll_statement_sha256(v_source),
    public._dealer_payroll_statement_sha256(v_payload), v_actor
  ) returning id into v_statement_id;

  insert into public.dealer_pt_wage_settlements (
    statement_id, dealer_id, club_id, status, covered_from, covered_to,
    minutes_reserved, amount_vnd, hourly_rate_vnd_snapshot,
    accrual_policy_snapshot, finalized_by
  ) values (
    v_statement_id, p_dealer_id, p_club_id, 'finalized', v_anchor, v_cutoff,
    v_minutes, v_amount, v_rate,
    v_financial_snapshot->'accrual_policy_snapshot', v_actor
  ) returning id into v_settlement_id;

  for v_segment in select value from jsonb_array_elements(v_rate_segments)
  loop
    v_line_no := v_line_no + 1;
    insert into public.dealer_payroll_statement_lines (
      statement_id, line_no, line_type, line_code, label, quantity, unit, unit_rate_vnd, amount_vnd, source_snapshot
    ) values (
      v_statement_id, v_line_no, 'rate_segment', 'pt_rate_segment', 'Luong theo don gia hieu luc',
      coalesce(nullif(v_segment->>'elapsed_seconds', '')::numeric, 0) / 3600,
      'gio', nullif(v_segment->>'hourly_rate_vnd', '')::bigint,
      floor(coalesce(nullif(v_segment->>'amount_vnd', '')::numeric, 0))::bigint,
      v_segment
    );
  end loop;

  if p_replaces_statement_id is not null then
    update public.dealer_payroll_statements
    set state = 'replaced', replaced_by_statement_id = v_statement_id
    where id = p_replaces_statement_id;
  end if;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', v_statement_id, p_club_id, 'INSERT',
    jsonb_build_object('statement_kind', 'part_time_settlement', 'state', 'finalized', 'net_amount_vnd', v_amount, 'cutoff_at', v_cutoff, 'statement_hash', public._dealer_payroll_statement_sha256(v_payload)),
    v_actor, coalesce(v_reason, 'PT payroll statement finalized with reserved cutoff')
  );
  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_pt_wage_settlements', v_settlement_id, p_club_id, 'INSERT',
    jsonb_build_object('statement_id', v_statement_id, 'covered_from', v_anchor, 'covered_to', v_cutoff, 'amount_vnd', v_amount),
    v_actor, coalesce(v_reason, 'PT wage interval reserved by finalized statement')
  );

  return jsonb_build_object(
    'statement_id', v_statement_id,
    'settlement_id', v_settlement_id,
    'state', 'finalized',
    'net_amount_vnd', v_amount,
    'cutoff_at', v_cutoff,
    'statement_hash', public._dealer_payroll_statement_sha256(v_payload),
    'idempotent', false
  );
end;
$function$
;
