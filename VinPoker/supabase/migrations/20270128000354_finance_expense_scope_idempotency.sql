BEGIN;
-- Owner-gated candidate, not applied. Harden the existing signature without
-- changing saved expenses, accounting periods, approvals or payment behavior.
-- Rollback: restore the exact pre-apply pg_get_functiondef and metadata captured
-- by the controlled runbook in a reviewed forward migration; preserve the 354
-- receipt and never remove or rewrite expenses created meanwhile.
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc
      WHERE oid='public.record_club_expense(uuid,public.expense_category,bigint,timestamptz,text,text,text,uuid,uuid,text,uuid,text)'::regprocedure)
     IS DISTINCT FROM 'ec4209e4c6e11503ecd4e52c5d4be0ee' THEN
    RAISE EXCEPTION 'finance_expense_source_drift';
  END IF;
END
$guard$;

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
    OR public.has_role(v_uid,'club_admin'::public.app_role)
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
-- CREATE OR REPLACE preserves existing ownership and EXECUTE grants. No new
-- endpoint or broader role grant is introduced by this candidate.
COMMIT;
