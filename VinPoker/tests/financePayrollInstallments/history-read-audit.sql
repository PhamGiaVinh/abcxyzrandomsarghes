-- READ ONLY. Aggregate compatibility counts, never names, references, or private payloads.
WITH statements AS (
  SELECT s.*, coalesce(p.paid,0) paid, coalesce(p.bad_scope,0) bad_scope,
    coalesce(p.bad_payment,0) bad_payment
  FROM public.dealer_payroll_statements s
  LEFT JOIN LATERAL (
    SELECT sum(p.amount_vnd) FILTER(WHERE p.voided_at IS NULL) paid,
      count(*) FILTER(WHERE p.club_id IS DISTINCT FROM s.club_id OR p.dealer_id IS DISTINCT FROM s.dealer_id) bad_scope,
      count(*) FILTER(WHERE p.voided_at IS NULL AND (p.amount_vnd<=0 OR p.amount_vnd>9007199254740991 OR p.paid_at IS NULL)) bad_payment
    FROM public.dealer_pt_wage_payments p WHERE p.statement_id=s.id
  ) p ON true
  WHERE s.statement_kind='part_time_settlement'
), lines AS (
  SELECT count(*) bad_lines FROM public.dealer_payroll_statement_lines l
  JOIN statements s ON s.id=l.statement_id
  WHERE l.line_no<=0 OR nullif(btrim(l.label),'') IS NULL
    OR (l.quantity IS NOT NULL AND l.quantity<0)
    OR (l.unit_rate_vnd IS NOT NULL AND (l.unit_rate_vnd<0 OR l.unit_rate_vnd>9007199254740991))
    OR abs(l.amount_vnd::numeric)>9007199254740991
)
SELECT jsonb_build_object(
  'audit','pt_read_history_compatibility_v1','as_of',now(),
  'statement_count',count(*),
  'supported_state_count',count(*) FILTER(WHERE state IN ('finalized','pdf_rendered','delivery_failed','sent','voided','replaced')),
  'invalid_identity_count',count(*) FILTER(WHERE statement_hash !~ '^[a-f0-9]{64}$' OR statement_hash IS NULL
    OR nullif(btrim(dealer_snapshot->>'full_name'),'') IS NULL OR nullif(btrim(club_snapshot->>'club_name'),'') IS NULL OR finalized_at IS NULL),
  'invalid_money_count',count(*) FILTER(WHERE net_amount_vnd<0 OR gross_amount_vnd<0 OR deduction_amount_vnd<0
    OR greatest(net_amount_vnd,gross_amount_vnd,deduction_amount_vnd)>9007199254740991
    OR gross_amount_vnd::numeric-deduction_amount_vnd<>net_amount_vnd),
  'invalid_totals_count',count(*) FILTER(WHERE paid>net_amount_vnd OR (state IN ('voided','replaced') AND paid<>0)),
  'invalid_payment_scope_count',coalesce(sum(bad_scope),0),
  'invalid_payment_values_count',coalesce(sum(bad_payment),0),
  'invalid_line_count',(SELECT bad_lines FROM lines)
) AS audit FROM statements;
