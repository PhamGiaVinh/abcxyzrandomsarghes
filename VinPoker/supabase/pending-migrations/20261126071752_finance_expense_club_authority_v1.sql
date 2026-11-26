BEGIN;
-- New owner-gated candidate. No saved expense, amount, receipt or payment changes.
-- Apply only after exact dependency 354 and frozen e231 source prerequisites.
-- Runbook must exclude concurrent function/policy DDL. Fail closed on drift.
-- Rollback: reviewed forward migration restoring captured definitions and policy;
-- retain all expenses and receipts. Do not restore a cross-club shortcut silently.
LOCK TABLE public.club_expenses IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.record_club_expense(uuid,public.expense_category,bigint,timestamptz,text,text,text,uuid,uuid,text,uuid,text)'::regprocedure)
    IS DISTINCT FROM 'a96cdd76edcbfb03cc1812b26047e179'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_club_expenses(uuid,timestamptz,timestamptz)'::regprocedure)
    IS DISTINCT FROM '15d1b9d63df67e34ee1d999adc7ffe08' THEN
    RAISE EXCEPTION 'expense_authority_function_preimage_drift';
  END IF;
END $guard$;
CREATE TEMP TABLE expense_authority_expected (LIKE public.club_expenses) ON COMMIT DROP;
CREATE POLICY "expense_authority_expected" ON pg_temp.expense_authority_expected FOR SELECT TO "authenticated" USING (("public"."has_role"("auth"."uid"(), 'super_admin'::"public"."app_role") OR "public"."has_role"("auth"."uid"(), 'club_admin'::"public"."app_role") OR (EXISTS ( SELECT 1
   FROM "public"."clubs" "c"
  WHERE (("c"."id" = expense_authority_expected.club_id) AND ("c"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."club_cashiers" "cc"
  WHERE (("cc"."club_id" = expense_authority_expected.club_id) AND ("cc"."user_id" = "auth"."uid"()))))));
DO $policy_guard$
DECLARE actual record; expected record;
BEGIN
  SELECT polcmd,polpermissive,polroles,pg_get_expr(polqual,polrelid) AS expression
    INTO STRICT actual FROM pg_policy WHERE polrelid='public.club_expenses'::regclass AND polname='club_expenses_select_operator';
  SELECT polcmd,polpermissive,polroles,replace(pg_get_expr(polqual,polrelid),'expense_authority_expected.club_id','club_expenses.club_id') AS expression
    INTO STRICT expected FROM pg_policy WHERE polrelid='pg_temp.expense_authority_expected'::regclass AND polname='expense_authority_expected';
  IF ROW(actual.polcmd,actual.polpermissive,actual.polroles,actual.expression)
    IS DISTINCT FROM ROW(expected.polcmd,expected.polpermissive,expected.polroles,expected.expression) THEN
    RAISE EXCEPTION 'expense_authority_policy_preimage_drift';
  END IF;
END $policy_guard$;
CREATE OR REPLACE FUNCTION public.record_club_expense(
  p_club_id uuid, p_category public.expense_category, p_amount_vnd bigint,
  p_incurred_at timestamptz, p_description text DEFAULT NULL,
  p_payment_status text DEFAULT 'unpaid', p_payment_source text DEFAULT NULL,
  p_tournament_id uuid DEFAULT NULL, p_series_id uuid DEFAULT NULL,
  p_attachment_url text DEFAULT NULL, p_adjusts_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_status text := coalesce(p_payment_status,'unpaid');
  v_prior public.club_expenses%ROWTYPE;
  v_id uuid;
  v_replayed boolean := false;
  v_constraint text;
  v_reference_club uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_amount_vnd IS NULL OR p_amount_vnd=0 THEN
    RETURN jsonb_build_object('error','INVALID_INPUT','detail','amount_vnd must be non-zero');
  END IF;
  IF v_status NOT IN ('paid','unpaid') THEN
    RETURN jsonb_build_object('error','INVALID_INPUT','detail','payment_status');
  END IF;
  IF NOT (
    public.has_role(v_uid,'super_admin'::public.app_role)
    OR EXISTS(SELECT FROM public.clubs c WHERE c.id=p_club_id AND c.owner_id=v_uid)
    OR EXISTS(SELECT FROM public.club_cashiers c WHERE c.club_id=p_club_id AND c.user_id=v_uid)
    OR public.is_club_accountant(v_uid,p_club_id)
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  -- Shared parent locks prevent a concurrent re-scope while this intent is
  -- validated and inserted. Foreign and missing IDs have the same error.
  IF p_tournament_id IS NOT NULL THEN
    SELECT t.club_id INTO v_reference_club
      FROM public.tournaments t WHERE t.id=p_tournament_id FOR SHARE;
    IF NOT FOUND OR v_reference_club IS DISTINCT FROM p_club_id
    THEN RAISE EXCEPTION 'expense_reference_scope_invalid' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_series_id IS NOT NULL THEN
    SELECT s.club_id INTO v_reference_club FROM public.tournament_series s
      WHERE s.id=p_series_id FOR SHARE;
    IF NOT FOUND OR v_reference_club IS DISTINCT FROM p_club_id THEN
      RAISE EXCEPTION 'expense_reference_scope_invalid' USING ERRCODE='42501';
    END IF;
  END IF;
  IF p_adjusts_id IS NOT NULL THEN
    SELECT e.club_id INTO v_reference_club FROM public.club_expenses e
      WHERE e.id=p_adjusts_id FOR SHARE;
    IF NOT FOUND OR v_reference_club IS DISTINCT FROM p_club_id THEN
      RAISE EXCEPTION 'expense_reference_scope_invalid' USING ERRCODE='42501';
    END IF;
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.club_expenses
      WHERE club_id=p_club_id AND idempotency_key=v_key;
    v_replayed := FOUND;
  END IF;
  IF NOT v_replayed THEN
    BEGIN
      INSERT INTO public.club_expenses(
        club_id,category,amount_vnd,description,incurred_at,tournament_id,series_id,
        payment_status,payment_source,entered_by,attachment_url,adjusts_id,idempotency_key
      ) VALUES (
        p_club_id,p_category,p_amount_vnd,p_description,p_incurred_at,p_tournament_id,p_series_id,
        v_status,p_payment_source,v_uid,p_attachment_url,p_adjusts_id,v_key
      ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
      IF v_key IS NULL OR v_constraint IS DISTINCT FROM 'uq_club_expenses_idem' THEN RAISE; END IF;
      SELECT * INTO v_prior FROM public.club_expenses
        WHERE club_id=p_club_id AND idempotency_key=v_key;
      IF NOT FOUND THEN RAISE; END IF;
      v_replayed := true;
    END;
  END IF;
  IF v_replayed THEN
    IF ROW(v_prior.category,v_prior.amount_vnd,v_prior.description,v_prior.incurred_at,
      v_prior.tournament_id,v_prior.series_id,v_prior.payment_status,v_prior.payment_source,
      v_prior.attachment_url,v_prior.adjusts_id)
      IS DISTINCT FROM ROW(p_category,p_amount_vnd,p_description,p_incurred_at,
      p_tournament_id,p_series_id,v_status,p_payment_source,p_attachment_url,p_adjusts_id)
    THEN RAISE EXCEPTION 'expense_idempotency_conflict' USING ERRCODE='22023'; END IF;
    v_id := v_prior.id;
  END IF;
  RETURN jsonb_build_object('status','ok','idempotent',v_replayed,'expense_id',v_id);
END;
$function$;
CREATE OR REPLACE FUNCTION "public"."get_club_expenses"("p_club_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
    OR public.is_club_accountant(v_uid, p_club_id)   -- [ACCT]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'from', p_from,
    'to', p_to,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'category', e.category, 'amount_vnd', e.amount_vnd,
               'description', e.description, 'incurred_at', e.incurred_at,
               'tournament_id', e.tournament_id, 'series_id', e.series_id,
               'payment_status', e.payment_status, 'payment_source', e.payment_source,
               'attachment_url', e.attachment_url, 'adjusts_id', e.adjusts_id,
               'entered_by', e.entered_by, 'created_at', e.created_at
             ) ORDER BY e.incurred_at DESC)
      FROM public.club_expenses e
      WHERE e.club_id = p_club_id AND e.incurred_at >= p_from AND e.incurred_at < p_to
    ), '[]'::jsonb),
    'total_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to
    ), 0),
    'by_category', COALESCE((
      SELECT jsonb_object_agg(category, cat_total)
      FROM (
        SELECT category, sum(amount_vnd) AS cat_total
        FROM public.club_expenses
        WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to
        GROUP BY category
      ) g
    ), '{}'::jsonb),
    'paid_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to AND payment_status = 'paid'
    ), 0),
    'unpaid_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to AND payment_status = 'unpaid'
    ), 0)
  );
END;
$$;
ALTER POLICY "club_expenses_select_operator" ON "public"."club_expenses" TO "authenticated" USING (("public"."has_role"("auth"."uid"(), 'super_admin'::"public"."app_role") OR (EXISTS ( SELECT 1
   FROM "public"."clubs" "c"
  WHERE (("c"."id" = "club_expenses"."club_id") AND ("c"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."club_cashiers" "cc"
  WHERE (("cc"."club_id" = "club_expenses"."club_id") AND ("cc"."user_id" = "auth"."uid"()))))));
COMMIT;
