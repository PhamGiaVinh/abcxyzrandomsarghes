-- PENDING ONLY. Not an active migration or permission to apply to production.
-- Canonical PT cash remains dealer_pt_wage_payments; approved statements are never recalculated.
-- ROLLBACK: before any adopted plan/payment, remove this extension and restore the exact
-- captured function/index. After adoption, do NOT drop guards or restore over money rows:
-- disable new writes, retain receipts/debt, and use a reviewed forward fix.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Readers belong to the independently qualified read-only release355. Never
-- recreate/replace them as a side effect of adopting installment writers.
DO $readers$ BEGIN
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('get_pt_statement_installments_v1','list_my_pt_statements_v1')) IS DISTINCT FROM 2
 OR (SELECT count(*) FROM pg_proc p WHERE
  ((p.oid=to_regprocedure('public.get_pt_statement_installments_v1(uuid)') AND md5(p.prosrc)='191f8b9de02702a828a1628d73ba8658'
    AND p.proargnames=ARRAY['p_statement_id'] AND p.pronargdefaults=0 AND p.proargdefaults IS NULL)
   OR (p.oid=to_regprocedure('public.list_my_pt_statements_v1(uuid,uuid,timestamptz,uuid)') AND md5(p.prosrc)='5788d4c196fba4cd5bae989f858d155c'
    AND p.proargnames=ARRAY['p_club_id','p_dealer_id','p_before_at','p_before_id'] AND p.pronargdefaults=2
    AND pg_get_expr(p.proargdefaults,0)='NULL::timestamp with time zone, NULL::uuid'))
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
  AND p.prokind='f' AND NOT p.proretset AND p.prorettype='jsonb'::regtype
  AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
  AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND p.proconfig=ARRAY['search_path=""'] AND p.proacl='{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]) IS DISTINCT FROM 2
 THEN RAISE EXCEPTION 'PT_INSTALLMENT_RELEASED_READERS_REQUIRED';END IF;
END $readers$;
-- Serialize the index preimage check with DDL on the canonical payment table.
-- A matching name alone is insufficient: never drop an unrelated/weakened index.
LOCK TABLE public.dealer_pt_wage_payments IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_index i
    WHERE i.indexrelid=to_regclass('public.dealer_pt_wage_payments_statement_uq')
      AND i.indrelid='public.dealer_pt_wage_payments'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
      AND NOT i.indisprimary AND NOT i.indisexclusion
      AND pg_catalog.pg_get_indexdef(i.indexrelid)=
        'CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq ON public.dealer_pt_wage_payments USING btree (statement_id) WHERE (statement_id IS NOT NULL)'
  ) THEN RAISE EXCEPTION 'PT_INSTALLMENT_LEGACY_INDEX_DRIFT'; END IF;
  IF to_regclass('public.finance_pt_installment_plans_v1') IS NOT NULL
    OR to_regprocedure('public.record_pt_statement_installment_v1(uuid,text,bigint,text,text,uuid,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'PT_INSTALLMENT_NAMESPACE_COLLISION'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure)
    IS DISTINCT FROM 'aef6ec6ce2d1db9fe44ed43bf8bd4d08'
  THEN RAISE EXCEPTION 'PT_INSTALLMENT_FULL_PAYMENT_SOURCE_DRIFT'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure)
    IS DISTINCT FROM 'e6388bd6fc1a1e07141ff0775385a606'
  THEN RAISE EXCEPTION 'PT_INSTALLMENT_SUMMARY_SOURCE_DRIFT'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_part_time_payroll_statement_status_v1(uuid,uuid,uuid)'::regprocedure)
    IS DISTINCT FROM 'c60a3e9eb07c88ced3b0c1c5f5fc5fbe'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_dealer_payroll_statement(uuid)'::regprocedure)
    IS DISTINCT FROM 'cb89ab61460df145c0731806f29da523'
  THEN RAISE EXCEPTION 'PT_INSTALLMENT_STATEMENT_READER_SOURCE_DRIFT'; END IF;
END $$;

CREATE TABLE public.finance_pt_installment_rollout_v1 (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE public.finance_pt_installment_rollout_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_pt_installment_rollout_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.finance_pt_installment_plans_v1 (
  statement_id uuid PRIMARY KEY REFERENCES public.dealer_payroll_statements(id),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  dealer_id uuid NOT NULL REFERENCES public.dealers(id),
  statement_hash text NOT NULL,
  approved_amount_vnd bigint NOT NULL CHECK(approved_amount_vnd>0),
  request_id uuid NOT NULL,
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK(nullif(btrim(reason),'') IS NOT NULL),
  UNIQUE(club_id,request_id)
);
ALTER TABLE public.finance_pt_installment_plans_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_pt_installment_plans_v1 FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.dealer_pt_wage_payments ADD COLUMN installment_request_id uuid;
-- Preserve the original single-payment constraint for every historical/legacy row.
DROP INDEX public.dealer_pt_wage_payments_statement_uq;
CREATE UNIQUE INDEX dealer_pt_wage_payments_statement_uq
  ON public.dealer_pt_wage_payments(statement_id)
  WHERE statement_id IS NOT NULL AND installment_request_id IS NULL;
CREATE UNIQUE INDEX dealer_pt_wage_installment_request_uq
  ON public.dealer_pt_wage_payments(club_id,installment_request_id)
  WHERE installment_request_id IS NOT NULL;
-- Statement aggregation must retain an index covering both legacy and installment rows.
CREATE INDEX dealer_pt_wage_payments_statement_lookup_idx
  ON public.dealer_pt_wage_payments(statement_id) WHERE statement_id IS NOT NULL;
ALTER TABLE public.dealer_pt_wage_payments ADD CONSTRAINT pt_installment_statement_required
  CHECK(installment_request_id IS NULL OR statement_id IS NOT NULL);

-- Shared lock boundary, used by approval, insert guard and payment recovery.
-- Locks match the existing finalizer/full-pay/void policy -> dealer -> statement -> settlement.
CREATE FUNCTION public._lock_pt_installment_statement_v1(p_statement_id uuid)
RETURNS public.dealer_payroll_statements LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.dealer_payroll_statements%rowtype; original_club uuid; original_dealer uuid;
  t public.dealer_pt_wage_settlements%rowtype;
BEGIN
  SELECT * INTO s FROM public.dealer_payroll_statements WHERE id=p_statement_id;
  IF NOT FOUND OR s.statement_kind<>'part_time_settlement' THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_STATEMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  PERFORM public._assert_dealer_payroll_statement_actor(s.club_id);
  original_club:=s.club_id; original_dealer:=s.dealer_id;
  PERFORM pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:'||original_club::text));
  PERFORM pg_advisory_xact_lock(hashtext('pt_wage:'||original_dealer::text));
  SELECT * INTO s FROM public.dealer_payroll_statements WHERE id=p_statement_id FOR UPDATE;
  IF NOT FOUND OR s.club_id IS DISTINCT FROM original_club OR s.dealer_id IS DISTINCT FROM original_dealer
    OR s.statement_kind<>'part_time_settlement' THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_CONTEXT_CHANGED' USING ERRCODE='55000'; END IF;
  PERFORM public._assert_dealer_payroll_statement_actor(s.club_id);
  SELECT * INTO t FROM public.dealer_pt_wage_settlements WHERE statement_id=s.id FOR UPDATE;
  IF NOT FOUND OR t.club_id IS DISTINCT FROM s.club_id OR t.dealer_id IS DISTINCT FROM s.dealer_id
    OR t.amount_vnd IS DISTINCT FROM s.net_amount_vnd OR t.covered_to IS DISTINCT FROM s.cutoff_at THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_SOURCE_BINDING_BROKEN' USING ERRCODE='55000'; END IF;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public._lock_pt_installment_statement_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.approve_pt_statement_installments_v1(
  p_statement_id uuid,p_expected_hash text,p_request_id uuid,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.dealer_payroll_statements%rowtype; a public.finance_pt_installment_plans_v1%rowtype;
  actor uuid; t public.dealer_pt_wage_settlements%rowtype;
BEGIN
  s:=public._lock_pt_installment_statement_v1(p_statement_id);
  actor:=public._assert_dealer_payroll_statement_finalizer(s.club_id);
  IF p_expected_hash IS DISTINCT FROM s.statement_hash OR p_request_id IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_INVALID_APPROVAL' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM public.dealers WHERE id=s.dealer_id AND user_id=actor) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_SELF_APPROVAL_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.finance_pt_installment_plans_v1 WHERE statement_id=s.id;
  IF FOUND THEN
    IF ROW(a.request_id,a.approved_by,a.reason) IS DISTINCT FROM ROW(p_request_id,actor,btrim(p_reason)) THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_APPROVAL_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('statement_id',s.id,'approved_amount_vnd',a.approved_amount_vnd,'idempotent',true);
  END IF;
  IF NOT EXISTS(SELECT FROM public.finance_pt_installment_rollout_v1 WHERE club_id=s.club_id AND enabled) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_DISABLED' USING ERRCODE='55000'; END IF;
  SELECT * INTO t FROM public.dealer_pt_wage_settlements WHERE statement_id=s.id;
  IF s.state NOT IN ('finalized','pdf_rendered','delivery_failed','sent') OR s.pt_wage_payment_id IS NOT NULL
    OR t.status<>'finalized' OR t.payment_id IS NOT NULL
    OR EXISTS(SELECT FROM public.dealer_pt_wage_payments WHERE statement_id=s.id) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_UNTOUCHED_STATEMENT_REQUIRED' USING ERRCODE='55000'; END IF;
  INSERT INTO public.finance_pt_installment_plans_v1(statement_id,club_id,dealer_id,statement_hash,
    approved_amount_vnd,request_id,approved_by,reason)
    VALUES(s.id,s.club_id,s.dealer_id,s.statement_hash,s.net_amount_vnd,p_request_id,actor,btrim(p_reason));
  INSERT INTO public.payroll_audit_log(table_name,record_id,club_id,action,new_values,changed_by,reason)
    VALUES('finance_pt_installment_plans_v1',s.id,s.club_id,'INSERT',
      jsonb_build_object('approved_amount_vnd',s.net_amount_vnd,'statement_hash',s.statement_hash),actor,btrim(p_reason));
  RETURN jsonb_build_object('statement_id',s.id,'approved_amount_vnd',s.net_amount_vnd,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.approve_pt_statement_installments_v1(uuid,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_pt_statement_installments_v1(uuid,text,uuid,text) TO authenticated;

CREATE FUNCTION public._guard_pt_installment_payment_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.dealer_payroll_statements%rowtype; t public.dealer_pt_wage_settlements%rowtype;
  a public.finance_pt_installment_plans_v1%rowtype; paid numeric; actor uuid; expected_minutes integer;
BEGIN
  IF TG_OP<>'INSERT' THEN
    IF old.installment_request_id IS NOT NULL OR (TG_OP='UPDATE' AND new.installment_request_id IS NOT NULL) THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_PAYMENT_IMMUTABLE' USING ERRCODE='55000'; END IF;
    IF TG_OP='DELETE' THEN RETURN old; ELSE RETURN new; END IF;
  END IF;
  IF new.statement_id IS NULL THEN
    -- Protect alternative legacy balance writers too, regardless of the rollout flag.
    PERFORM pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:'||new.club_id::text));
    PERFORM pg_advisory_xact_lock(hashtext('pt_wage:'||new.dealer_id::text));
    IF EXISTS(SELECT FROM public.finance_pt_installment_plans_v1 a
      JOIN public.dealer_pt_wage_settlements t USING(statement_id)
      WHERE a.dealer_id=new.dealer_id AND t.status<>'voided'
        AND new.covered_from<t.covered_to AND new.covered_to>t.covered_from) THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_ADOPTED_INTERVAL_RESERVED' USING ERRCODE='55000'; END IF;
    RETURN new;
  END IF;
  s:=public._lock_pt_installment_statement_v1(new.statement_id);
  SELECT * INTO a FROM public.finance_pt_installment_plans_v1 WHERE statement_id=s.id;
  IF new.installment_request_id IS NULL THEN
    IF FOUND THEN RAISE EXCEPTION 'PT_INSTALLMENT_USE_INSTALLMENT_API' USING ERRCODE='55000'; END IF;
    RETURN new;
  END IF;
  IF NOT FOUND OR a.statement_hash IS DISTINCT FROM s.statement_hash OR a.approved_amount_vnd IS DISTINCT FROM s.net_amount_vnd THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_APPROVAL_REQUIRED' USING ERRCODE='55000'; END IF;
  actor:=public._assert_dealer_payroll_statement_actor(s.club_id);
  SELECT * INTO t FROM public.dealer_pt_wage_settlements WHERE statement_id=s.id;
  IF NOT EXISTS(SELECT FROM public.finance_pt_installment_rollout_v1 WHERE club_id=s.club_id AND enabled)
    OR s.state NOT IN ('finalized','pdf_rendered','delivery_failed','sent') OR t.status<>'finalized' THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_NOT_PAYABLE' USING ERRCODE='55000'; END IF;
  SELECT coalesce(sum(amount_vnd),0) INTO paid FROM public.dealer_pt_wage_payments WHERE statement_id=s.id;
  IF new.amount_vnd<=0 OR paid+new.amount_vnd>a.approved_amount_vnd THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_AMOUNT_EXCEEDS_REMAINING' USING ERRCODE='22023'; END IF;
  expected_minutes:=floor(t.minutes_reserved::numeric*(paid+new.amount_vnd)/a.approved_amount_vnd)
    -floor(t.minutes_reserved::numeric*paid/a.approved_amount_vnd);
  IF ROW(new.club_id,new.dealer_id,new.paid_by,new.created_by,new.covered_from,new.covered_to,
      new.hourly_rate_vnd_snapshot,new.accrual_policy_snapshot,new.minutes_paid,new.idempotency_key)
    IS DISTINCT FROM ROW(s.club_id,s.dealer_id,actor,actor,t.covered_from,t.covered_to,
      t.hourly_rate_vnd_snapshot,t.accrual_policy_snapshot,expected_minutes,new.installment_request_id::text)
    OR new.voided_at IS NOT NULL OR new.voided_by IS NOT NULL
    OR new.payment_method IS NULL OR new.payment_method NOT IN ('bank','cash')
    OR (new.payment_method='bank' AND nullif(btrim(new.payment_reference),'') IS NULL) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_PAYMENT_BINDING_BROKEN' USING ERRCODE='22023'; END IF;
  PERFORM floor_private.assert_pt_no_monthly_overlap_v1(s.dealer_id,
    CASE WHEN jsonb_typeof(s.source_snapshot->'rate_segments')='array' AND jsonb_array_length(s.source_snapshot->'rate_segments')>0
      THEN s.source_snapshot->'rate_segments' ELSE jsonb_build_array(jsonb_build_object('segment_start',t.covered_from,'segment_end',t.covered_to)) END);
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public._guard_pt_installment_payment_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_finance_pt_installment_payment_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.dealer_pt_wage_payments FOR EACH ROW EXECUTE FUNCTION public._guard_pt_installment_payment_v1();

CREATE FUNCTION public._finish_pt_installment_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ BEGIN
  IF new.installment_request_id IS NOT NULL THEN
    IF (SELECT sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE statement_id=new.statement_id)=
       (SELECT approved_amount_vnd FROM public.finance_pt_installment_plans_v1 WHERE statement_id=new.statement_id) THEN
      UPDATE public.dealer_pt_wage_settlements SET status='paid',payment_id=new.id WHERE statement_id=new.statement_id;
      UPDATE public.dealer_payroll_statements SET pt_wage_payment_id=new.id WHERE id=new.statement_id;
    END IF;
    INSERT INTO public.payroll_audit_log(table_name,record_id,club_id,action,new_values,changed_by,reason)
      VALUES('dealer_pt_wage_payments',new.id,new.club_id,'INSERT',
      jsonb_build_object('statement_id',new.statement_id,'amount_vnd',new.amount_vnd,'request_id',new.installment_request_id),
      new.paid_by,'PT immutable statement installment');
  END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public._finish_pt_installment_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_finance_pt_installment_finish AFTER INSERT ON public.dealer_pt_wage_payments
  FOR EACH ROW EXECUTE FUNCTION public._finish_pt_installment_v1();

-- Guard original lifecycle writers: an unpaid plan can still be voided by its authorized
-- lifecycle, but no partial/paid liability can be erased or have its last-payment marker forged.
CREATE FUNCTION public._guard_pt_installment_lifecycle_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$ DECLARE sid uuid; paid numeric; approved bigint; link uuid; BEGIN
  IF TG_TABLE_NAME='dealer_payroll_statements' THEN sid:=old.id; ELSE sid:=old.statement_id; END IF;
  SELECT approved_amount_vnd INTO approved FROM public.finance_pt_installment_plans_v1 WHERE statement_id=sid;
  IF NOT FOUND THEN RETURN new; END IF;
  SELECT coalesce(sum(amount_vnd),0) INTO paid FROM public.dealer_pt_wage_payments WHERE statement_id=sid;
  IF TG_TABLE_NAME='dealer_payroll_statements' THEN
    IF new.state IN ('voided','replaced') AND new.state IS DISTINCT FROM old.state THEN
      PERFORM public._assert_dealer_payroll_statement_finalizer(new.club_id);
    END IF;
    IF paid>0 AND (new.state IN ('voided','replaced') OR new.replaced_by_statement_id IS NOT NULL) THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_PAID_DEBT_CANNOT_BE_VOIDED' USING ERRCODE='55000'; END IF;
    IF new.pt_wage_payment_id IS DISTINCT FROM old.pt_wage_payment_id THEN link:=new.pt_wage_payment_id; END IF;
  ELSE
    IF new.status='voided' AND new.status IS DISTINCT FROM old.status THEN
      PERFORM public._assert_dealer_payroll_statement_finalizer(new.club_id);
    END IF;
    IF paid>0 AND new.status='voided' THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_PAID_DEBT_CANNOT_BE_VOIDED' USING ERRCODE='55000'; END IF;
    IF new.status='paid' AND old.status<>'paid' THEN link:=new.payment_id; END IF;
  END IF;
  IF link IS NOT NULL AND (paid<>approved OR NOT EXISTS(SELECT FROM public.dealer_pt_wage_payments
    WHERE id=link AND statement_id=sid AND installment_request_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_SETTLEMENT_MARKER_INVALID' USING ERRCODE='55000'; END IF;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION public._guard_pt_installment_lifecycle_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_finance_pt_statement_lifecycle BEFORE UPDATE ON public.dealer_payroll_statements
  FOR EACH ROW EXECUTE FUNCTION public._guard_pt_installment_lifecycle_v1();
CREATE TRIGGER trg_finance_pt_settlement_lifecycle BEFORE UPDATE ON public.dealer_pt_wage_settlements
  FOR EACH ROW EXECUTE FUNCTION public._guard_pt_installment_lifecycle_v1();

-- Preserve original signature, owner and ACL; fail if exact preimage or insertion seam drifts.
DO $patch$ DECLARE def text; needle text; replacement text; BEGIN
  SELECT pg_get_functiondef('public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)'::regprocedure) INTO def;
  needle:='v_actor := public._assert_dealer_payroll_statement_actor(v_statement.club_id);';
  IF (length(def)-length(replace(def,needle,'')))/length(needle)<>2 THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_FULL_PAYMENT_PATCH_SEAM_DRIFT'; END IF;
  replacement:=needle||E'\n  IF EXISTS(SELECT FROM public.finance_pt_installment_plans_v1 WHERE statement_id=p_statement_id) THEN\n    RAISE EXCEPTION ''PT_INSTALLMENT_USE_INSTALLMENT_API'' USING ERRCODE=''55000'';\n  END IF;';
  EXECUTE replace(def,needle,replacement);
END $patch$;

CREATE FUNCTION public.record_pt_statement_installment_v1(
  p_statement_id uuid,p_expected_hash text,p_amount_vnd bigint,p_payment_method text,
  p_payment_reference text,p_request_id uuid,p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.dealer_payroll_statements%rowtype; t public.dealer_pt_wage_settlements%rowtype;
  a public.finance_pt_installment_plans_v1%rowtype; p public.dealer_pt_wage_payments%rowtype;
  actor uuid; paid numeric; minutes integer; replay boolean:=false;
  ref text:=nullif(btrim(p_payment_reference),''); note_text text:=nullif(btrim(p_note),'');
BEGIN
  s:=public._lock_pt_installment_statement_v1(p_statement_id);
  actor:=public._assert_dealer_payroll_statement_actor(s.club_id);
  IF p_expected_hash IS DISTINCT FROM s.statement_hash OR p_request_id IS NULL OR p_amount_vnd IS NULL
    OR p_amount_vnd<=0 OR p_payment_method IS NULL OR p_payment_method NOT IN ('bank','cash')
    OR (p_payment_method='bank' AND ref IS NULL) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.finance_pt_installment_plans_v1 WHERE statement_id=s.id;
  IF NOT FOUND OR a.statement_hash IS DISTINCT FROM s.statement_hash OR a.approved_amount_vnd IS DISTINCT FROM s.net_amount_vnd THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_APPROVAL_REQUIRED' USING ERRCODE='55000'; END IF;
  SELECT * INTO p FROM public.dealer_pt_wage_payments WHERE club_id=s.club_id AND installment_request_id=p_request_id;
  IF FOUND THEN
    IF ROW(p.statement_id,p.amount_vnd,p.payment_method,p.payment_reference,p.note,p.paid_by)
      IS DISTINCT FROM ROW(s.id,p_amount_vnd,p_payment_method,ref,note_text,actor) THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_REQUEST_CONFLICT' USING ERRCODE='22023'; END IF;
    replay:=true;
  ELSE
    SELECT * INTO t FROM public.dealer_pt_wage_settlements WHERE statement_id=s.id;
    SELECT coalesce(sum(amount_vnd),0) INTO paid FROM public.dealer_pt_wage_payments WHERE statement_id=s.id;
    IF paid+p_amount_vnd>a.approved_amount_vnd THEN
      RAISE EXCEPTION 'PT_INSTALLMENT_AMOUNT_EXCEEDS_REMAINING' USING ERRCODE='22023'; END IF;
    minutes:=floor(t.minutes_reserved::numeric*(paid+p_amount_vnd)/a.approved_amount_vnd)
      -floor(t.minutes_reserved::numeric*paid/a.approved_amount_vnd);
    -- The independent insert trigger checks rollout, state, approval, actor, budget and every source field.
    INSERT INTO public.dealer_pt_wage_payments(dealer_id,club_id,amount_vnd,minutes_paid,hourly_rate_vnd_snapshot,
      covered_from,covered_to,paid_by,created_by,payment_method,payment_reference,idempotency_key,note,
      accrual_policy_snapshot,statement_id,installment_request_id)
    VALUES(s.dealer_id,s.club_id,p_amount_vnd,minutes,t.hourly_rate_vnd_snapshot,t.covered_from,t.covered_to,
      actor,actor,p_payment_method,ref,p_request_id::text,note_text,t.accrual_policy_snapshot,s.id,p_request_id)
    RETURNING * INTO p;
  END IF;
  SELECT coalesce(sum(amount_vnd),0) INTO paid FROM public.dealer_pt_wage_payments WHERE statement_id=s.id;
  RETURN jsonb_build_object('statement_id',s.id,'payment_id',p.id,'amount_vnd',p.amount_vnd,
    'paid_total_vnd',paid,'remaining_vnd',a.approved_amount_vnd-paid,'idempotent',replay);
END $$;
REVOKE ALL ON FUNCTION public.record_pt_statement_installment_v1(uuid,text,bigint,text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_pt_statement_installment_v1(uuid,text,bigint,text,text,uuid,text) TO authenticated;

CREATE FUNCTION public._reject_pt_installment_plan_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  RAISE EXCEPTION 'PT_INSTALLMENT_APPROVAL_IMMUTABLE' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION public._reject_pt_installment_plan_mutation_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_finance_pt_plan_immutable BEFORE UPDATE OR DELETE ON public.finance_pt_installment_plans_v1
  FOR EACH ROW EXECUTE FUNCTION public._reject_pt_installment_plan_mutation_v1();

-- Preserve the existing authorization, date contract, cash rows and report structure.
-- Only current finalized debt changes: the immutable approved amount minus actual
-- nonvoided payments for this exact statement/dealer/club, independent of selected period.
DO $summary$ DECLARE def text; needle text; replacement text; BEGIN
  SELECT pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure) INTO def;
  needle:='select coalesce(sum(s.amount_vnd),0) into v_dealer_pt_finalized';
  IF (length(def)-length(replace(def,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_SUMMARY_PATCH_SEAM_DRIFT'; END IF;
  replacement:=$body$
  if exists(select 1 from public.dealer_pt_wage_settlements s
    where s.club_id=any(v_club_ids) and s.status='finalized'
      and s.amount_vnd < coalesce((select sum(w.amount_vnd) from public.dealer_pt_wage_payments w
        where w.statement_id=s.statement_id and w.club_id=s.club_id and w.dealer_id=s.dealer_id and w.voided_at is null),0)) then
    raise exception 'finance_pt_installment_invalid_remaining' using errcode='22023';
  end if;
  select coalesce(sum(s.amount_vnd-coalesce((select sum(w.amount_vnd)
    from public.dealer_pt_wage_payments w where w.statement_id=s.statement_id
      and w.club_id=s.club_id and w.dealer_id=s.dealer_id and w.voided_at is null),0)),0) into v_dealer_pt_finalized
  $body$;
  EXECUTE replace(def,needle,replacement);
END $summary$;

-- Existing operator status must not infer zero cash from a still-null final link.
-- Preserve all original role/club/dealer/request filters; add canonical totals only.
DO $status$ DECLARE def text; needle text; replacement text; BEGIN
  SELECT pg_get_functiondef('public.get_part_time_payroll_statement_status_v1(uuid,uuid,uuid)'::regprocedure) INTO def;
  needle:='DECLARE s public.dealer_payroll_statements%ROWTYPE;';
  IF (length(def)-length(replace(def,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_STATUS_DECLARATION_DRIFT'; END IF;
  def:=replace(def,needle,needle||' paid bigint;');
  needle:='IF NOT FOUND THEN RETURN NULL;END IF;';
  IF (length(def)-length(replace(def,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_STATUS_READ_SEAM_DRIFT'; END IF;
  replacement:=needle||$read$
  SELECT coalesce(sum(amount_vnd),0) INTO paid FROM public.dealer_pt_wage_payments
    WHERE statement_id=s.id AND dealer_id=s.dealer_id AND club_id=s.club_id AND voided_at IS NULL;
  IF paid>s.net_amount_vnd OR (s.state IN ('voided','replaced') AND paid<>0) THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_STATUS_INVALID_TOTALS' USING ERRCODE='22023'; END IF;
  $read$;
  def:=replace(def,needle,replacement);
  needle:='''payment_id'',s.pt_wage_payment_id,''statement_hash'',s.statement_hash';
  IF (length(def)-length(replace(def,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'PT_INSTALLMENT_STATUS_RETURN_SEAM_DRIFT'; END IF;
  replacement:=needle||$totals$,
    'installments_adopted',EXISTS(SELECT FROM public.finance_pt_installment_plans_v1 WHERE statement_id=s.id),
    'paid_total_vnd',paid,'remaining_vnd',CASE WHEN s.state IN ('voided','replaced') THEN 0 ELSE s.net_amount_vnd-paid END
  $totals$;
  EXECUTE replace(def,needle,replacement);
END $status$;
COMMIT;
