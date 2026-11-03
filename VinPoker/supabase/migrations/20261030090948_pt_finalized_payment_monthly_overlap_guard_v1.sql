-- PENDING LOCAL. Requires90337; existing immutable statement/payment replay retained.
-- Recovery: restore exact prior function definition; never rewrite stored statements.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('floor_private.assert_pt_no_monthly_overlap_v1(uuid,jsonb)') IS NULL OR
 (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure) IS DISTINCT FROM '055c8285f122151bf69989658df929a8' THEN RAISE EXCEPTION 'pt_finalized_overlap_dependency_or_drift';END IF;
END $$;
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
COMMIT;


