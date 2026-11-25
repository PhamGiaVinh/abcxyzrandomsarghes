\ir installments.seed.sql
DO $pay$
DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; h text:=current_setting('test.pt_statement_hash');
  a jsonb; p jsonb; r jsonb; d jsonb;
BEGIN
  a:=public.approve_pt_statement_installments_v1(s,h,'18000000-0000-4000-8000-000000000092','TEST owner approves 5M budget');
  p:=public.record_pt_statement_installment_v1(s,h,2000000,'bank','TEST part 1','18000000-0000-4000-8000-000000000093','TEST 2M');
  IF p->>'amount_vnd' IS DISTINCT FROM '2000000' OR p->>'paid_total_vnd' IS DISTINCT FROM '2000000'
    OR p->>'remaining_vnd' IS DISTINCT FROM '3000000' OR p->>'idempotent' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'first_installment_not_two_million_with_three_remaining'; END IF;
  r:=public.record_pt_statement_installment_v1(s,h,2000000,'bank','TEST part 1','18000000-0000-4000-8000-000000000093','TEST 2M');
  IF r->>'payment_id' IS DISTINCT FROM p->>'payment_id' OR r->>'idempotent' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'lost_response_created_duplicate_payment'; END IF;
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(s,h,3000000,'bank','TEST part 1','18000000-0000-4000-8000-000000000093','TEST 2M');
    RAISE EXCEPTION 'changed_request_accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.pay_finalized_part_time_payroll_statement(s,'bank','TEST must not add 5M','legacy-after-installment','TEST');
    RAISE EXCEPTION 'legacy_full_payment_accepted_after_installment';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    PERFORM public.void_dealer_payroll_statement(s,'TEST must not erase 3M debt');
    RAISE EXCEPTION 'partial_debt_voided';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  d:=public.get_pt_statement_installments_v1(s);
  IF d->>'approved_amount_vnd' IS DISTINCT FROM '5000000' OR d->>'remaining_vnd' IS DISTINCT FROM '3000000'
    OR jsonb_array_length(d->'payments')<>1 THEN RAISE EXCEPTION 'detail_lost_partial_debt'; END IF;
  IF public.get_club_pt_wages('18000000-0000-4000-8000-000000000001')->'dealers'->0->>'balance_vnd' IS DISTINCT FROM '0'
    THEN RAISE EXCEPTION 'partial_payment_released_reserved_interval'; END IF;
END $pay$;
RESET ROLE;
DO $independent$ DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; p public.dealer_pt_wage_payments%rowtype; BEGIN
  IF NOT EXISTS(SELECT FROM public.dealer_pt_wage_settlements WHERE statement_id=s AND status='finalized' AND payment_id IS NULL)
    OR NOT EXISTS(SELECT FROM public.dealer_payroll_statements WHERE id=s AND pt_wage_payment_id IS NULL)
  THEN RAISE EXCEPTION 'partial_installment_marked_settled_early'; END IF;
  SELECT * INTO STRICT p FROM public.dealer_pt_wage_payments WHERE statement_id=s;
  p.id:=gen_random_uuid(); p.installment_request_id:=gen_random_uuid(); p.idempotency_key:=p.installment_request_id::text; p.amount_vnd:=4000000;
  BEGIN
    INSERT INTO public.dealer_pt_wage_payments SELECT p.*;
    RAISE EXCEPTION 'insert_guard_allowed_overspend_without_RPC';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  p.amount_vnd:=1000000; p.minutes_paid:=0;
  BEGIN
    INSERT INTO public.dealer_pt_wage_payments SELECT p.*;
    RAISE EXCEPTION 'insert_guard_allowed_false_earning_minutes';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    UPDATE public.dealer_pt_wage_payments SET voided_at=now(),voided_by=paid_by WHERE statement_id=s;
    RAISE EXCEPTION 'installment_void_erased_paid_money';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $independent$;
UPDATE public.finance_pt_installment_rollout_v1 SET enabled=false;
SET LOCAL ROLE authenticated;
DO $disabled$ DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; h text:=current_setting('test.pt_statement_hash'); r jsonb; BEGIN
  r:=public.record_pt_statement_installment_v1(s,h,2000000,'bank','TEST part 1','18000000-0000-4000-8000-000000000093','TEST 2M');
  IF r->>'amount_vnd' IS DISTINCT FROM '2000000' OR r->>'remaining_vnd' IS DISTINCT FROM '3000000'
    OR r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'disabled_receipt_recovery_broken'; END IF;
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(s,h,1000000,'cash',NULL,'18000000-0000-4000-8000-000000000097','TEST disabled');
    RAISE EXCEPTION 'disabled_new_payment_accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN
    PERFORM public.pay_finalized_part_time_payroll_statement(s,'cash',NULL,'TEST flag off bypass','TEST');
    RAISE EXCEPTION 'disabled_legacy_bypass_accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $disabled$;
RESET ROLE;
UPDATE public.finance_pt_installment_rollout_v1 SET enabled=true;
SET LOCAL ROLE authenticated;
DO $finish$
DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; h text:=current_setting('test.pt_statement_hash'); p jsonb; r jsonb;
BEGIN
  BEGIN
    PERFORM public.record_pt_statement_installment_v1(s,h,3000001,'bank','TEST overspend','18000000-0000-4000-8000-000000000094','TEST');
    RAISE EXCEPTION 'overspend_accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  p:=public.record_pt_statement_installment_v1(s,h,3000000,'cash',NULL,'18000000-0000-4000-8000-000000000095','TEST remainder');
  IF p->>'paid_total_vnd' IS DISTINCT FROM '5000000' OR p->>'remaining_vnd' IS DISTINCT FROM '0'
  THEN RAISE EXCEPTION 'last_installment_not_settled'; END IF;
  r:=public.record_pt_statement_installment_v1(s,h,2000000,'bank','TEST part 1','18000000-0000-4000-8000-000000000093','TEST 2M');
  IF r->>'amount_vnd' IS DISTINCT FROM '2000000' OR r->>'remaining_vnd' IS DISTINCT FROM '0'
    OR r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'original_receipt_lost_after_settlement'; END IF;
END $finish$;
RESET ROLE;
DO $store$ DECLARE s uuid:=current_setting('test.pt_statement_id')::uuid; BEGIN
  IF NOT EXISTS(SELECT FROM public.dealer_payroll_statements p CROSS JOIN pt_statement_before b
    WHERE p.id=s AND (to_jsonb(p)-'pt_wage_payment_id')=(b.snapshot-'pt_wage_payment_id'))
  THEN RAISE EXCEPTION 'original_approved_statement_changed'; END IF;
  IF (SELECT count(*) FROM public.dealer_pt_wage_payments WHERE statement_id=s)<>2
    OR (SELECT sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE statement_id=s)<>5000000
    OR (SELECT sum(minutes_paid) FROM public.dealer_pt_wage_payments WHERE statement_id=s)<>6000
  THEN RAISE EXCEPTION 'cash_or_minutes_double_counted'; END IF;
  IF NOT EXISTS(SELECT FROM public.dealer_pt_wage_settlements WHERE statement_id=s AND status='paid')
  THEN RAISE EXCEPTION 'paid_settlement_not_marked_paid'; END IF;
END $store$;
ROLLBACK;
SELECT 'PT_INSTALLMENTS_5M_TO_3M_TO_ZERO_RETRY_IMMUTABILITY_PASS' AS result;
