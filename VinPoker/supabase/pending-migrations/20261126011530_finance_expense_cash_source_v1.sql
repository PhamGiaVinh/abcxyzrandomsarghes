-- Isolated candidate only. Requires reviewed expense354 and PT cash-source candidate.
-- One new positive expense + explicit till funding receipt + one movement, atomically.
-- Does not pay an existing unpaid expense, infer an advance, or turn a cost correction
-- into cash returned. Approval/delegated-limit qualification is a separate dependency.
-- ROLLBACK: keep immutable facts/source links/readers. Reverting the frontend is safe;
-- disabling source enforcement after adoption restores the old gap and is NOT recovery.
-- Suspend an unsafe cash write path and forward-repair under the controlled runbook.
DO $preimage$
BEGIN
 IF to_regclass('public.finance_expense_cash_receipts') IS NOT NULL
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public'
  AND table_name='cashier_tour_settings' AND column_name='expense_cash_source_enabled')
 OR to_regclass('public.cashier_one_movement_per_expense_cash_receipt') IS NOT NULL THEN
  RAISE EXCEPTION 'finance_expense_cash_candidate_collision'; END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.cashier_buyin_movements'::regclass
  AND conname='cashier_pt_source_shape')
 OR NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public'
  AND table_name='cashier_tour_settings' AND column_name='pt_cash_drawer_link_enabled') THEN
  RAISE EXCEPTION 'finance_expense_cash_requires_pt_source_candidate'; END IF;
 IF md5((SELECT prosrc FROM pg_proc WHERE
  oid='public.record_club_expense(uuid,public.expense_category,bigint,timestamptz,text,text,text,uuid,uuid,text,uuid,text)'::regprocedure)) IS DISTINCT FROM 'a96cdd76edcbfb03cc1812b26047e179' THEN
  RAISE EXCEPTION 'finance_expense_cash_requires_expense354'; END IF;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.cashier_close_shift_v1(uuid,bigint)'::regprocedure))
  IS DISTINCT FROM '05f2f114e3cae4cc9f2176c1e16fcefa' THEN
  RAISE EXCEPTION 'finance_expense_cash_close_drift'; END IF;
END $preimage$;

ALTER TABLE public.cashier_tour_settings ADD COLUMN expense_cash_source_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE public.finance_expense_cash_receipts (
 request_id uuid PRIMARY KEY,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 expense_id uuid NOT NULL UNIQUE REFERENCES public.club_expenses(id) ON DELETE RESTRICT,
 shift_id uuid NOT NULL REFERENCES public.cashier_till_shifts(id) ON DELETE RESTRICT,
 amount_vnd bigint NOT NULL CHECK(amount_vnd>0),
 paid_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 paid_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.finance_expense_cash_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.finance_expense_cash_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.finance_expense_cash_receipts TO authenticated;
CREATE POLICY expense_cash_receipts_read ON public.finance_expense_cash_receipts FOR SELECT TO authenticated
 USING(public.is_club_cashier(auth.uid(),club_id) OR public.is_club_accountant(auth.uid(),club_id));
ALTER TABLE public.cashier_buyin_movements ADD COLUMN club_expense_cash_receipt_id uuid
 REFERENCES public.finance_expense_cash_receipts(request_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX cashier_one_movement_per_expense_cash_receipt
 ON public.cashier_buyin_movements(club_expense_cash_receipt_id) WHERE club_expense_cash_receipt_id IS NOT NULL;

DO $extend_only$
DECLARE original_shape text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT original_shape FROM pg_constraint
 WHERE conrelid='public.cashier_buyin_movements'::regclass AND conname='cashier_movement_shape';
 ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT cashier_movement_shape;
 EXECUTE 'ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_movement_shape '
 || left(original_shape,length(original_shape)-1)
 || ' OR (purpose=''club_expense'' AND method=''cash'' AND direction=''out'' AND shift_id IS NOT NULL AND club_expense_cash_receipt_id IS NOT NULL AND dealer_pt_wage_payment_id IS NULL AND tournament_id IS NULL AND registration_id IS NULL AND refund_id IS NULL AND bank_transaction_id IS NULL AND prize_payment_id IS NULL AND applied_amount=amount))';
 ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT cashier_buyin_movements_purpose_check;
 ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_buyin_movements_purpose_check
 CHECK(purpose IN('buyin','refund','drawer_adjustment','prize_payout','dealer_pt_wage','club_expense'));
 ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT cashier_expense_source_shape
 CHECK((purpose='club_expense')=(club_expense_cash_receipt_id IS NOT NULL));
END $extend_only$;

-- Lock adoption before a new paid-cash fact. A deferred fence permits the public
-- source RPC to create the cost and its receipt in the same transaction. Historical
-- exact replay inserts nothing and never acquires a new source retrospectively.
CREATE FUNCTION floor_private.lock_expense_cash_policy_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.payment_status='paid' AND NEW.payment_source='cash' THEN
  PERFORM 1 FROM public.cashier_tour_settings WHERE club_id=NEW.club_id FOR SHARE;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_lock_expense_cash_policy BEFORE INSERT OR UPDATE ON public.club_expenses
 FOR EACH ROW EXECUTE FUNCTION floor_private.lock_expense_cash_policy_v1();
CREATE FUNCTION floor_private.require_expense_cash_source_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.payment_status='paid' AND NEW.payment_source='cash'
 AND coalesce((SELECT expense_cash_source_enabled FROM public.cashier_tour_settings WHERE club_id=NEW.club_id),false)
 AND NOT EXISTS(SELECT FROM public.finance_expense_cash_receipts WHERE expense_id=NEW.id) THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_EXPLICIT_CASH_SOURCE_REQUIRED' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_require_expense_cash_source AFTER INSERT OR UPDATE ON public.club_expenses
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.require_expense_cash_source_v1();

CREATE FUNCTION floor_private.verify_expense_cash_receipt_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expense public.club_expenses%ROWTYPE; till public.cashier_till_shifts%ROWTYPE; enabled boolean;
BEGIN
 SELECT expense_cash_source_enabled INTO enabled FROM public.cashier_tour_settings
 WHERE club_id=NEW.club_id FOR SHARE;
 IF NOT coalesce(enabled,false) THEN RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_DISABLED' USING ERRCODE='55000';END IF;
 SELECT * INTO expense FROM public.club_expenses WHERE id=NEW.expense_id FOR SHARE;
 IF NOT FOUND OR expense.club_id IS DISTINCT FROM NEW.club_id OR expense.amount_vnd IS DISTINCT FROM NEW.amount_vnd
 OR expense.payment_status IS DISTINCT FROM 'paid' OR expense.payment_source IS DISTINCT FROM 'cash'
 OR expense.entered_by IS DISTINCT FROM NEW.paid_by OR expense.adjusts_id IS NOT NULL
 OR expense.idempotency_key IS DISTINCT FROM 'finance-cash-expense:'||NEW.request_id::text THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_SOURCE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT * INTO till FROM public.cashier_till_shifts WHERE id=NEW.shift_id FOR UPDATE;
 IF NOT FOUND OR till.club_id IS DISTINCT FROM NEW.club_id OR till.closed_at IS NOT NULL THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_SHIFT_NOT_OPEN' USING ERRCODE='55000';END IF;
 IF auth.uid() IS NULL OR NEW.paid_by IS DISTINCT FROM auth.uid()
 OR NOT public.is_club_cashier(auth.uid(),NEW.club_id) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 -- Actual cash event time is assigned after the till lock, never supplied by a client.
 NEW.paid_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER finance_verify_expense_cash_receipt BEFORE INSERT ON public.finance_expense_cash_receipts
 FOR EACH ROW EXECUTE FUNCTION floor_private.verify_expense_cash_receipt_v1();

CREATE FUNCTION floor_private.preserve_expense_cash_facts_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='finance_expense_cash_receipts' THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_RECEIPT_IMMUTABLE' USING ERRCODE='23514';
 ELSIF TG_TABLE_NAME='club_expenses' THEN
  IF EXISTS(SELECT FROM public.finance_expense_cash_receipts WHERE expense_id=OLD.id) THEN
   RAISE EXCEPTION 'FINANCE_FUNDED_EXPENSE_IMMUTABLE' USING ERRCODE='23514';END IF;
 ELSIF TG_OP='UPDATE' AND NEW.club_expense_cash_receipt_id IS DISTINCT FROM OLD.club_expense_cash_receipt_id THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_SOURCE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_preserve_expense_cash_receipt BEFORE UPDATE OR DELETE ON public.finance_expense_cash_receipts
 FOR EACH ROW EXECUTE FUNCTION floor_private.preserve_expense_cash_facts_v1();
CREATE TRIGGER finance_preserve_funded_expense BEFORE UPDATE OR DELETE ON public.club_expenses
 FOR EACH ROW EXECUTE FUNCTION floor_private.preserve_expense_cash_facts_v1();
CREATE TRIGGER finance_preserve_expense_movement_source BEFORE UPDATE ON public.cashier_buyin_movements
 FOR EACH ROW EXECUTE FUNCTION floor_private.preserve_expense_cash_facts_v1();

CREATE FUNCTION floor_private.verify_expense_cash_movement_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.finance_expense_cash_receipts%ROWTYPE;
BEGIN
 IF NEW.purpose<>'club_expense' THEN RETURN NEW;END IF;
 SELECT * INTO receipt FROM public.finance_expense_cash_receipts WHERE request_id=NEW.club_expense_cash_receipt_id;
 IF NOT FOUND OR ROW(receipt.club_id,receipt.shift_id,receipt.amount_vnd,receipt.paid_by,receipt.paid_at)
 IS DISTINCT FROM ROW(NEW.club_id,NEW.shift_id,NEW.amount,NEW.actor_id,NEW.created_at) THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_MOVEMENT_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_verify_expense_cash_movement BEFORE INSERT ON public.cashier_buyin_movements
 FOR EACH ROW EXECUTE FUNCTION floor_private.verify_expense_cash_movement_v1();

CREATE FUNCTION floor_private.require_expense_cash_movement_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.cashier_buyin_movements WHERE club_expense_cash_receipt_id=NEW.request_id) THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_MOVEMENT_REQUIRED' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_require_expense_cash_movement AFTER INSERT ON public.finance_expense_cash_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.require_expense_cash_movement_v1();

CREATE FUNCTION public.record_cashier_club_expense_v1(
 p_request_id uuid,p_club_id uuid,p_shift_id uuid,p_category public.expense_category,
 p_amount_vnd bigint,p_incurred_at timestamptz,p_description text DEFAULT NULL,
 p_tournament_id uuid DEFAULT NULL,p_series_id uuid DEFAULT NULL,p_attachment_url text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); enabled boolean; result jsonb;
 receipt public.finance_expense_cash_receipts%ROWTYPE; expense public.club_expenses%ROWTYPE;
 till public.cashier_till_shifts%ROWTYPE; available numeric; v_expense_id uuid;
BEGIN
 IF actor IS NULL OR NOT public.is_club_cashier(actor,p_club_id) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR p_shift_id IS NULL OR p_amount_vnd IS NULL OR p_amount_vnd<=0 OR p_incurred_at IS NULL THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_INVALID_INPUT' USING ERRCODE='22023';END IF;
 SELECT * INTO receipt FROM public.finance_expense_cash_receipts WHERE request_id=p_request_id AND club_id=p_club_id;
 IF NOT FOUND THEN
  SELECT expense_cash_source_enabled INTO enabled FROM public.cashier_tour_settings WHERE club_id=p_club_id FOR SHARE;
  IF NOT coalesce(enabled,false) THEN RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_DISABLED' USING ERRCODE='55000';END IF;
  --354 owns reference locking, tenant validation and exact replay. It runs before
  --the till lock. No cost/receipt/movement is externally visible before commit.
  result:=public.record_club_expense(p_club_id,p_category,p_amount_vnd,p_incurred_at,p_description,
   'paid','cash',p_tournament_id,p_series_id,p_attachment_url,NULL,'finance-cash-expense:'||p_request_id::text);
  IF result->>'status' IS DISTINCT FROM 'ok' OR result->>'expense_id' IS NULL THEN
   RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_RECORD_REFUSED' USING ERRCODE='22023';END IF;
  v_expense_id:=(result->>'expense_id')::uuid;
  SELECT * INTO receipt FROM public.finance_expense_cash_receipts WHERE request_id=p_request_id AND club_id=p_club_id;
  IF NOT FOUND THEN
   IF (result->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'FINANCE_EXPENSE_LEGACY_SOURCE_UNVERIFIED' USING ERRCODE='55000';END IF;
   SELECT * INTO till FROM public.cashier_till_shifts WHERE id=p_shift_id FOR UPDATE;
   IF NOT FOUND OR till.club_id IS DISTINCT FROM p_club_id OR till.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_SHIFT_NOT_OPEN' USING ERRCODE='55000';END IF;
   IF NOT public.is_club_cashier(actor,p_club_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';END IF;
   IF NOT public.cashier_tour_active_v1(p_club_id) THEN
    RAISE EXCEPTION 'FINANCE_EXPENSE_CASHIER_DISABLED' USING ERRCODE='55000';END IF;
   SELECT till.opening_cash+coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0)
    INTO available FROM public.cashier_buyin_movements WHERE shift_id=p_shift_id AND method='cash';
   IF available<p_amount_vnd THEN RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_INSUFFICIENT' USING ERRCODE='55000';END IF;
   INSERT INTO public.finance_expense_cash_receipts(request_id,club_id,expense_id,shift_id,amount_vnd,paid_by)
   VALUES(p_request_id,p_club_id,v_expense_id,p_shift_id,p_amount_vnd,actor) RETURNING * INTO receipt;
   INSERT INTO public.cashier_buyin_movements(club_id,shift_id,direction,method,purpose,amount,applied_amount,
    actor_id,idempotency_key,reason,club_expense_cash_receipt_id,created_at)
   VALUES(p_club_id,p_shift_id,'out','cash','club_expense',p_amount_vnd,p_amount_vnd,actor,
    'expense-cash:'||p_request_id::text,'Club expense paid from explicitly selected Cashier till',p_request_id,receipt.paid_at);
   RETURN jsonb_build_object('status','ok','idempotent',false,'expense_id',v_expense_id,
    'request_id',receipt.request_id,'shift_id',receipt.shift_id,'amount_vnd',receipt.amount_vnd,'paid_at',receipt.paid_at);
  END IF;
 END IF;
 SELECT * INTO STRICT expense FROM public.club_expenses WHERE id=receipt.expense_id;
 IF ROW(receipt.shift_id,receipt.amount_vnd,receipt.paid_by,expense.club_id,expense.category,
  expense.amount_vnd,expense.incurred_at,expense.description,expense.tournament_id,expense.series_id,expense.attachment_url)
 IS DISTINCT FROM ROW(p_shift_id,p_amount_vnd,actor,p_club_id,p_category,p_amount_vnd,
  p_incurred_at,p_description,p_tournament_id,p_series_id,p_attachment_url) THEN
  RAISE EXCEPTION 'FINANCE_EXPENSE_CASH_INTENT_CONFLICT' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('status','ok','idempotent',true,'expense_id',receipt.expense_id,
  'request_id',receipt.request_id,'shift_id',receipt.shift_id,'amount_vnd',receipt.amount_vnd,'paid_at',receipt.paid_at);
END $$;
REVOKE ALL ON FUNCTION public.record_cashier_club_expense_v1(uuid,uuid,uuid,public.expense_category,bigint,timestamptz,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_cashier_club_expense_v1(uuid,uuid,uuid,public.expense_category,bigint,timestamptz,text,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION floor_private.lock_expense_cash_policy_v1(),floor_private.require_expense_cash_source_v1(),
 floor_private.verify_expense_cash_receipt_v1(),floor_private.preserve_expense_cash_facts_v1(),
 floor_private.verify_expense_cash_movement_v1(),floor_private.require_expense_cash_movement_v1() FROM PUBLIC,anon,authenticated,service_role;

DO $reader_preimages$ BEGIN
 IF md5((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='cashier_shift_summary_v1')) IS DISTINCT FROM '1f1c769ab4ca981905f8e8df03704b26'
 OR md5((SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='cashier_cashflow_range_v1')) IS DISTINCT FROM 'c95e949f38307fae5afe0f75de256236' THEN RAISE EXCEPTION 'finance_expense_cash_requires_exact_pt_readers';END IF;
END $reader_preimages$;

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
    'club_expense_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='club_expense'),0),
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
    'club_expense_cash_out',coalesce(sum(amount) FILTER (WHERE method='cash' AND direction='out' AND purpose='club_expense'),0),
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
