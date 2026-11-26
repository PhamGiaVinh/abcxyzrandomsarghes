-- CLI-created local candidate, kept outside automatic migration replay until qualified.
-- Apply atomically only after exact-catalog review and owner approval.
-- Default OFF per club. Does not change wage arithmetic, approval rules or old receipts.
-- ROLLBACK: frontend may revert while retaining additive readers and source linking.
-- Once linked facts exist, an unsafe cash path must be suspended and forward-repaired;
-- turning linking OFF is not a safe financial rollback (it restores the legacy gap).
-- Never delete financial facts or restore the old movement CHECK after linked rows exist.
DO $preimage$
BEGIN
 IF md5((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.cashier_buyin_movements'::regclass AND conname='cashier_movement_shape')) IS DISTINCT FROM 'a9adb6bb4765ebf05e08b81d266fc5ef'
 OR md5((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.cashier_buyin_movements'::regclass AND conname='cashier_buyin_movements_purpose_check')) IS DISTINCT FROM 'ac257a85a122fcd124a63e4b58dafa2f'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure)) IS DISTINCT FROM 'aef6ec6ce2d1db9fe44ed43bf8bd4d08'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.cashier_close_shift_v1(uuid,bigint)'::regprocedure)) IS DISTINCT FROM '05f2f114e3cae4cc9f2176c1e16fcefa'
 THEN RAISE EXCEPTION 'finance_pt_cash_requires_exact_current_catalog';END IF;
 IF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND column_name IN('pt_cash_drawer_link_enabled','cashier_shift_id','dealer_pt_wage_payment_id') AND table_name IN('cashier_tour_settings','dealer_pt_wage_payments','cashier_buyin_movements'))
 THEN RAISE EXCEPTION 'finance_pt_cash_candidate_already_present';END IF;
 IF to_regclass('public.cashier_one_movement_per_pt_wage_payment') IS NOT NULL THEN
  RAISE EXCEPTION 'finance_pt_cash_index_name_collision';END IF;
END $preimage$;

ALTER TABLE public.cashier_tour_settings ADD COLUMN IF NOT EXISTS pt_cash_drawer_link_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.dealer_pt_wage_payments ADD COLUMN IF NOT EXISTS cashier_shift_id uuid REFERENCES public.cashier_till_shifts(id) ON DELETE RESTRICT;
ALTER TABLE public.cashier_buyin_movements ADD COLUMN IF NOT EXISTS dealer_pt_wage_payment_id uuid REFERENCES public.dealer_pt_wage_payments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX cashier_one_movement_per_pt_wage_payment
 ON public.cashier_buyin_movements(dealer_pt_wage_payment_id) WHERE dealer_pt_wage_payment_id IS NOT NULL;
ALTER TABLE public.dealer_pt_wage_payments ADD CONSTRAINT dealer_pt_cash_source_method
 CHECK(cashier_shift_id IS NULL OR (payment_method IS NOT DISTINCT FROM 'cash' AND voided_at IS NULL));

DO $extend_only$
DECLARE original_shape text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT original_shape FROM pg_constraint
 WHERE conrelid='public.cashier_buyin_movements'::regclass AND conname='cashier_movement_shape';
 ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT cashier_movement_shape;
 -- Preserve the entire current buy-in/refund/adjustment/prize predicate verbatim.
 EXECUTE 'ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_movement_shape '
 || left(original_shape,length(original_shape)-1)
 || ' OR (purpose=''dealer_pt_wage'' AND method=''cash'' AND direction=''out'' AND shift_id IS NOT NULL AND dealer_pt_wage_payment_id IS NOT NULL AND tournament_id IS NULL AND registration_id IS NULL AND refund_id IS NULL AND bank_transaction_id IS NULL AND prize_payment_id IS NULL AND applied_amount=amount))';
 ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT cashier_buyin_movements_purpose_check;
 ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_buyin_movements_purpose_check
 CHECK(purpose IN('buyin','refund','drawer_adjustment','prize_payout','dealer_pt_wage'));
 ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_pt_source_shape
 CHECK((purpose='dealer_pt_wage')=(dealer_pt_wage_payment_id IS NOT NULL));
END $extend_only$;

CREATE FUNCTION floor_private.bind_pt_cash_drawer_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE enabled boolean; target_shift uuid;
BEGIN
 -- SHARE prevents the switch changing halfway through a payment transaction.
 SELECT s.pt_cash_drawer_link_enabled INTO enabled FROM public.cashier_tour_settings s
 WHERE s.club_id=NEW.club_id FOR SHARE;
 IF NEW.cashier_shift_id IS NOT NULL THEN
  RAISE EXCEPTION 'FINANCE_CASH_SOURCE_IS_SERVER_SELECTED' USING ERRCODE='22023';
 END IF;
 IF NOT coalesce(enabled,false) OR NEW.payment_method IS DISTINCT FROM 'cash' THEN RETURN NEW;END IF;
 PERFORM public._assert_dealer_payroll_statement_actor(NEW.club_id);
 IF NEW.voided_at IS NOT NULL OR NEW.amount_vnd<=0 OR NEW.paid_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'FINANCE_CASH_PAYMENT_INVALID' USING ERRCODE='22023';END IF;
 BEGIN
  SELECT s.id INTO STRICT target_shift FROM public.cashier_till_shifts s
  WHERE s.club_id=NEW.club_id AND s.closed_at IS NULL FOR UPDATE;
 EXCEPTION WHEN no_data_found THEN
  RAISE EXCEPTION 'FINANCE_CASH_OPEN_SHIFT_REQUIRED' USING ERRCODE='55000';
 END;
 -- Recheck role after waiting for a concurrent drawer close/payment.
 PERFORM public._assert_dealer_payroll_statement_actor(NEW.club_id);
 NEW.cashier_shift_id:=target_shift;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.bind_pt_cash_drawer_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_bind_pt_cash_drawer BEFORE INSERT ON public.dealer_pt_wage_payments
 FOR EACH ROW EXECUTE FUNCTION floor_private.bind_pt_cash_drawer_v1();

CREATE FUNCTION floor_private.preserve_pt_cash_source_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.cashier_shift_id IS DISTINCT FROM OLD.cashier_shift_id THEN
  RAISE EXCEPTION 'FINANCE_CASH_SOURCE_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.preserve_pt_cash_source_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_preserve_pt_cash_source BEFORE UPDATE ON public.dealer_pt_wage_payments
 FOR EACH ROW EXECUTE FUNCTION floor_private.preserve_pt_cash_source_v1();

CREATE FUNCTION floor_private.record_pt_cash_movement_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.cashier_shift_id IS NOT NULL THEN
  INSERT INTO public.cashier_buyin_movements(club_id,shift_id,direction,method,purpose,amount,applied_amount,
   actor_id,idempotency_key,reason,dealer_pt_wage_payment_id)
  VALUES(NEW.club_id,NEW.cashier_shift_id,'out','cash','dealer_pt_wage',NEW.amount_vnd,NEW.amount_vnd,
   NEW.paid_by,'dealer-pt-wage:'||NEW.id::text,'PT wage payment from canonical receipt',NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.record_pt_cash_movement_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_record_pt_cash_movement AFTER INSERT ON public.dealer_pt_wage_payments
 FOR EACH ROW EXECUTE FUNCTION floor_private.record_pt_cash_movement_v1();

CREATE FUNCTION floor_private.verify_pt_cash_movement_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payment public.dealer_pt_wage_payments%ROWTYPE; current_shift public.cashier_till_shifts%ROWTYPE;
BEGIN
 IF NEW.purpose<>'dealer_pt_wage' THEN RETURN NEW;END IF;
 SELECT * INTO payment FROM public.dealer_pt_wage_payments WHERE id=NEW.dealer_pt_wage_payment_id;
 IF NOT FOUND OR payment.club_id IS DISTINCT FROM NEW.club_id OR payment.cashier_shift_id IS DISTINCT FROM NEW.shift_id
 OR payment.payment_method IS DISTINCT FROM 'cash' OR payment.voided_at IS NOT NULL
 OR payment.amount_vnd IS DISTINCT FROM NEW.amount OR payment.paid_by IS DISTINCT FROM NEW.actor_id THEN
  RAISE EXCEPTION 'FINANCE_CASH_PAYMENT_SOURCE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT * INTO current_shift FROM public.cashier_till_shifts WHERE id=NEW.shift_id FOR UPDATE;
 IF NOT FOUND OR current_shift.club_id IS DISTINCT FROM NEW.club_id OR current_shift.closed_at IS NOT NULL THEN
  RAISE EXCEPTION 'FINANCE_CASH_SHIFT_NOT_OPEN' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.verify_pt_cash_movement_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_verify_pt_cash_movement BEFORE INSERT ON public.cashier_buyin_movements
 FOR EACH ROW EXECUTE FUNCTION floor_private.verify_pt_cash_movement_v1();

-- Existing close RPC already sums every cash direction under this same till row lock.
-- It remains unchanged. Existing source writer arithmetic, ACLs and idempotent replay
-- also remain unchanged: an old payment replay cannot insert or retro-link a receipt.

DO $read_preimages$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.cashier_shift_summary_v1(uuid)'::regprocedure)) IS DISTINCT FROM '680c8bd3b1d35ad7a64cbc5fa8f23ef9'
 OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.cashier_cashflow_range_v1(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '2d38704980a33f5f6a6e98345e0a4349' THEN RAISE EXCEPTION 'finance_pt_cash_requires_current_readers';END IF;
END $read_preimages$;

CREATE OR REPLACE FUNCTION "public"."cashier_shift_summary_v1"("p_shift_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_actor uuid:=auth.uid(); v_shift public.cashier_till_shifts%ROWTYPE; v_totals jsonb; v_net bigint;
BEGIN
  SELECT * INTO v_shift FROM public.cashier_till_shifts WHERE id=p_shift_id;
  IF NOT FOUND OR v_actor IS NULL OR NOT public.is_club_cashier(v_actor,v_shift.club_id) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT jsonb_build_object(
    'cash_in',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='in' AND purpose='buyin'),0),
    'cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='refund'),0),
    'dealer_pt_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='dealer_pt_wage'),0),
    'prize_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='prize_payout'),0),
    'bank_in',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0),
    'bank_out',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='out' AND purpose='refund'),0),
    'unallocated_bank',coalesce(sum(amount-applied_amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0),
    'cash_adjustments',coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END)
      FILTER (WHERE purpose='drawer_adjustment'),0),
    'movement_count',count(*)) INTO v_totals
  FROM public.cashier_buyin_movements m
  WHERE m.club_id=v_shift.club_id AND (
    (m.method='cash' AND m.shift_id=v_shift.id)
    OR (m.method='bank' AND m.created_at>=v_shift.opened_at
      AND (v_shift.closed_at IS NULL OR m.created_at<v_shift.closed_at))
  );
  SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0) INTO v_net FROM public.cashier_buyin_movements WHERE shift_id=v_shift.id AND method='cash';
  RETURN jsonb_build_object('ok',true,'shift_id',v_shift.id,'club_id',v_shift.club_id,
    'opened_at',v_shift.opened_at,'closed_at',v_shift.closed_at,
    'opening_cash',v_shift.opening_cash,'expected_cash',CASE WHEN v_shift.closed_at IS NULL THEN v_shift.opening_cash+v_net ELSE v_shift.expected_cash END,
    'counted_cash',v_shift.counted_cash,'variance_cash',v_shift.variance_cash,
    'totals',v_totals);
END $$;

CREATE OR REPLACE FUNCTION "public"."cashier_cashflow_range_v1"("p_club_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_actor uuid:=auth.uid(); v_cash jsonb; v_entries jsonb; v_variance bigint;
  v_adjustments bigint;
  v_unmatched_verified_bank bigint;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>=p_to
    OR p_to-p_from>interval '400 days' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  IF NOT (public.is_club_cashier(v_actor,p_club_id)
    OR EXISTS(SELECT 1 FROM public.club_accountants a WHERE a.club_id=p_club_id AND a.user_id=v_actor)
    OR EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=v_actor AND u.role='super_admin')) THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  SELECT jsonb_build_object(
    'cash_in',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='in' AND purpose='buyin'),0),
    'cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='refund'),0),
    'dealer_pt_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='dealer_pt_wage'),0),
    'prize_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='prize_payout'),0),
    'bank_in',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0),
    'bank_out',coalesce(sum(amount) FILTER (WHERE method='bank' AND direction='out' AND purpose='refund'),0),
    'unallocated_bank',coalesce(sum(amount-applied_amount) FILTER (WHERE method='bank' AND direction='in' AND purpose='buyin'),0))
    INTO v_cash FROM public.cashier_buyin_movements
     WHERE club_id=p_club_id AND created_at>=p_from AND created_at<p_to;
  SELECT coalesce(sum(b.amount),0) INTO v_unmatched_verified_bank
    FROM public.bank_transactions b
    WHERE b.provider='sepay' AND b.status='unmatched' AND b.transfer_type='in'
      AND b.api_verified_at IS NOT NULL AND b.amount>0
      AND coalesce(b.occurred_at,b.created_at)>=p_from
      AND coalesce(b.occurred_at,b.created_at)<p_to
      AND EXISTS(SELECT 1 FROM public.platform_bank_accounts a
        WHERE a.account_number=b.account_number AND a.club_id=p_club_id AND a.is_active)
      AND NOT EXISTS(SELECT 1 FROM public.platform_bank_accounts a
        WHERE a.account_number=b.account_number AND a.club_id IS DISTINCT FROM p_club_id
          AND a.club_id IS NOT NULL AND a.is_active)
      AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
        WHERE m.bank_transaction_id=b.id);
  WITH events AS (
    -- Payment is cash flow; allocation happens only after a seat/entry is
    -- confirmed. Paid registrations waiting for a table remain unallocated.
    SELECT r.id,r.buy_in,r.price_snapshot,r.confirmed_at AS event_at,1 AS sign
      FROM public.tournament_registrations r
      WHERE r.club_id=p_club_id AND r.cashier_paid_at IS NOT NULL
        AND r.confirmed_at>=p_from AND r.confirmed_at<p_to
    UNION ALL
    SELECT r.id,r.buy_in,r.price_snapshot,f.paid_at,-1
      FROM public.cashier_refund_requests f
      JOIN public.tournament_registrations r ON r.id=f.registration_id
      WHERE f.club_id=p_club_id AND f.status='paid' AND r.confirmed_at IS NOT NULL
        AND f.paid_at>=p_from AND f.paid_at<p_to
  )
  SELECT jsonb_build_object('prize_delta',coalesce(sum(sign*buy_in),0),
    'fees_delta',coalesce(sum(sign*((price_snapshot->>'rake')::bigint
      +(price_snapshot->>'service_fee')::bigint+(price_snapshot->>'platform_fee')::bigint))
      FILTER (WHERE price_snapshot ?& array['rake','service_fee','platform_fee']),0),
    'unclassified_entries',count(DISTINCT id) FILTER
      (WHERE price_snapshot IS NULL OR NOT (price_snapshot ?& array['rake','service_fee','platform_fee'])))
    INTO v_entries FROM events;
  SELECT coalesce(sum(variance_cash),0) INTO v_variance FROM public.cashier_till_shifts
    WHERE club_id=p_club_id AND closed_at>=p_from AND closed_at<p_to;
  SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0)
    INTO v_adjustments FROM public.cashier_buyin_movements
    WHERE club_id=p_club_id AND purpose='drawer_adjustment'
      AND created_at>=p_from AND created_at<p_to;
  RETURN jsonb_build_object('ok',true,'club_id',p_club_id,'from',p_from,'to',p_to,
    'cash_flow',v_cash,'unmatched_verified_bank',v_unmatched_verified_bank,
    'entry_allocation',v_entries,'closed_shift_variance',v_variance,
    'drawer_adjustments',v_adjustments);
END $$;
