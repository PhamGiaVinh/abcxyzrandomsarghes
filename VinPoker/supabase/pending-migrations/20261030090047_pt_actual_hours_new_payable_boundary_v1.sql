-- PENDING LOCAL CANDIDATE. Owner2026-10-30: actual hours for NEW PT payable.
-- Preserve saved monthly rows, receipt replay and existing payment history.
-- Recovery: restore guarded prior definitions from retained catalog; no data rollback.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.calculate_club_payroll(uuid,date,date)'::regprocedure) IS DISTINCT FROM '567b2e6bbe069ca294bc8e81cc6b8416' THEN RAISE EXCEPTION 'pt_actual_hours_catalog_drift'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_payroll_period(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure) IS DISTINCT FROM '22700d30ffd8fb9e347858ada9ff53c2' THEN RAISE EXCEPTION 'pt_actual_hours_catalog_drift'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.calculate_club_payroll(p_club_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dealer RECORD;
  v_results JSONB := '{}'::JSONB;
  v_payroll JSONB;
  v_period_id UUID;
  v_dealer_payroll RECORD;
  v_total_adjustments BIGINT;
BEGIN
  -- [ACCT-GATE] P0-6 security fix: previously NO authz — any authenticated user could
  -- read any club's payroll. Roles below = all legitimate consumers + accountant.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR false /* payroll141_global_role_not_club_membership */
    OR public.is_club_admin(auth.uid(), p_club_id)
    OR public.is_club_dealer_control(auth.uid(), p_club_id)
    OR (
      (public.has_role(auth.uid(), 'cashier'::public.app_role)
       OR public.has_role(auth.uid(), 'club_cashier'::public.app_role))
      AND EXISTS (
        SELECT 1 FROM public.club_cashiers cc
        WHERE cc.club_id = p_club_id AND cc.user_id = auth.uid()
      )
    )
    OR public.is_club_accountant(auth.uid(), p_club_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id
    AND period_start = p_start_date
    AND period_end = p_end_date;

  IF FOUND THEN
    FOR v_dealer_payroll IN
      SELECT dp.*, d.full_name, d.standard_hours_per_shift, d.ot_multiplier AS dealer_ot_mult
      FROM dealer_payroll dp
      JOIN dealers d ON d.id = dp.dealer_id
      WHERE dp.period_id = v_period_id
        AND dp.club_id = p_club_id
        AND dp.status != 'excluded'
      ORDER BY d.full_name
    LOOP
      SELECT COALESCE(SUM(
        CASE adjustment_type
          WHEN 'BONUS' THEN amount_vnd
          WHEN 'PENALTY' THEN -amount_vnd
          WHEN 'DEDUCTION' THEN -amount_vnd
          WHEN 'ADVANCE' THEN -amount_vnd
          WHEN 'OTHER' THEN amount_vnd
          ELSE 0
        END
      ), 0)
      INTO v_total_adjustments
      FROM payroll_adjustments
      WHERE payroll_id = v_dealer_payroll.id;

      v_payroll := jsonb_build_object(
        'dealer_id', v_dealer_payroll.dealer_id,
        'full_name', v_dealer_payroll.full_name,
        'employment_type', v_dealer_payroll.employment_type,
        'monthly_salary_vnd', v_dealer_payroll.monthly_salary_vnd,
        'hourly_rate_vnd', v_dealer_payroll.hourly_rate_vnd,
        'standard_hours_per_shift', COALESCE(v_dealer_payroll.standard_hours_per_shift, 8),
        'ot_multiplier', COALESCE(v_dealer_payroll.dealer_ot_mult, 1.5),
        'total_shifts', COALESCE(v_dealer_payroll.total_shifts, 0),
        'total_hours', COALESCE(v_dealer_payroll.total_hours, 0),
        'regular_hours', COALESCE(v_dealer_payroll.regular_hours, 0),
        'ot_hours', COALESCE(v_dealer_payroll.ot_hours, 0),
        'base_salary_vnd', COALESCE(v_dealer_payroll.base_salary_vnd, 0),
        'regular_pay_vnd', COALESCE(v_dealer_payroll.regular_pay_vnd, 0),
        'ot_pay_vnd', COALESCE(v_dealer_payroll.ot_pay_vnd, 0),
        'gross_pay_vnd', COALESCE(v_dealer_payroll.gross_pay_vnd, 0),
        'total_adjustments_vnd', COALESCE(v_total_adjustments, 0),
        'tips_amount_vnd', COALESCE(v_dealer_payroll.tips_amount_vnd, 0),
        'bhxh_deduction_vnd', COALESCE(v_dealer_payroll.bhxh_deduction_vnd, 0),
        'bhyt_deduction_vnd', COALESCE(v_dealer_payroll.bhyt_deduction_vnd, 0),
        'bhtn_deduction_vnd', COALESCE(v_dealer_payroll.bhtn_deduction_vnd, 0),
        'pit_deduction_vnd', COALESCE(v_dealer_payroll.pit_deduction_vnd, 0),
        -- B5: saved-path net = stored after-tax + live adjustments (post-save adjustments stay visible; stored rows untouched)
        'net_pay_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0) + COALESCE(v_total_adjustments, 0),
        'net_pay_after_tax_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0),
        'shifts', '[]'::JSONB
      );

      v_results := v_results || jsonb_build_object(v_dealer_payroll.dealer_id::text, v_payroll);
    END LOOP;
  ELSE
    FOR v_dealer IN
      SELECT id FROM dealers
      WHERE club_id = p_club_id AND status = 'active' AND employment_type IS DISTINCT FROM 'part_time' /* PT new payable uses actual-hours ledger only; saved branch above remains final. */
      ORDER BY full_name
    LOOP
      v_payroll := calculate_dealer_payroll(v_dealer.id, p_start_date, p_end_date);
      v_results := v_results || jsonb_build_object(v_dealer.id::text, v_payroll);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'period_start', p_start_date,
    'period_end', p_end_date,
    'dealers', v_results
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_payroll_period(p_club_id uuid, p_year integer, p_month integer, p_start_date date, p_end_date date, p_payroll_rows jsonb, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_id UUID;
  v_row JSONB;
  v_calc JSONB;
  v_dealer_id UUID;
  v_client_gross BIGINT := 0;
  v_client_net BIGINT := 0;
  v_server_gross BIGINT := 0;
  v_server_net BIGINT := 0;
  v_rows_saved INT := 0;
  v_rows_skipped INT := 0;
  v_server jsonb; v_expected jsonb; v_client jsonb; v_server_rows jsonb:='[]'::jsonb;
  v_ids text[]:='{}'; v_id text; v_state text;
  v_keys text[]:=ARRAY['dealer_id','employment_type','monthly_salary_vnd','hourly_rate_vnd','ot_multiplier',
    'total_shifts','total_hours','regular_hours','ot_hours','base_salary_vnd','regular_pay_vnd','ot_pay_vnd',
    'gross_pay_vnd','total_adjustments_vnd','tips_amount_vnd','bhxh_deduction_vnd','bhyt_deduction_vnd',
    'bhtn_deduction_vnd','pit_deduction_vnd','net_pay_vnd','net_pay_after_tax_vnd'];
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'payroll_actor_mismatch' USING ERRCODE='42501';END IF;
  IF NOT public._is_payroll_accountant(p_club_id) THEN PERFORM public.assert_payroll_actor(p_club_id);END IF;
  IF p_year IS NULL OR p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'payroll_period_invalid' USING ERRCODE='22023';END IF;
  IF p_start_date IS DISTINCT FROM make_date(p_year,p_month,1)
    OR p_end_date IS DISTINCT FROM (make_date(p_year,p_month,1)+interval '1 month - 1 day')::date THEN
    RAISE EXCEPTION 'payroll_period_dates_mismatch' USING ERRCODE='22023';END IF;
  IF p_payroll_rows IS NULL OR jsonb_typeof(p_payroll_rows)<>'array' THEN
    RAISE EXCEPTION 'payroll_rows_invalid' USING ERRCODE='22023';END IF;
  -- Serialize absent-period creation too; period row lock serializes transitions.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-save:'||p_club_id||':'||p_year||':'||p_month,0));
  SELECT status INTO v_state FROM public.payroll_periods
    WHERE club_id=p_club_id AND period_year=p_year AND period_month=p_month FOR UPDATE;
  IF FOUND AND (v_state IS NULL OR v_state NOT IN('draft','rejected')) THEN
    RAISE EXCEPTION 'payroll_period_not_editable' USING ERRCODE='22023';END IF;
  -- Stabilize existing dealer/config/attendance and saved-row inputs while taking
  -- the canonical snapshot. Preserve the calculator's formulas and saved branch.
  PERFORM id FROM public.dealers WHERE club_id=p_club_id ORDER BY id FOR UPDATE;
  PERFORM club_id FROM public.club_settings WHERE club_id=p_club_id FOR SHARE;
  PERFORM a.id FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id
    WHERE d.club_id=p_club_id AND a.check_in_time < ((p_end_date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND (a.check_out_time IS NULL OR a.check_out_time >= (p_start_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
    ORDER BY a.id FOR UPDATE OF a;
  PERFORM dp.id FROM public.dealer_payroll dp JOIN public.payroll_periods pp ON pp.id=dp.period_id
    WHERE pp.club_id=p_club_id AND pp.period_year=p_year AND pp.period_month=p_month ORDER BY dp.id FOR UPDATE OF dp;
  -- Forward-only boundary: existing saved PT history remains untouched.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_payroll_rows) r
    JOIN public.dealers d ON d.id::text=(r->>'dealer_id') AND d.club_id=p_club_id
    WHERE d.employment_type='part_time' AND NOT EXISTS (
      SELECT 1 FROM public.dealer_payroll dp JOIN public.payroll_periods pp ON pp.id=dp.period_id
      WHERE dp.dealer_id=d.id AND dp.club_id=p_club_id AND pp.club_id=p_club_id
        AND pp.period_start=p_start_date AND pp.period_end=p_end_date
    )
  ) THEN RAISE EXCEPTION 'PT_NEW_PAYABLE_REQUIRES_ACTUAL_HOURS_LEDGER' USING ERRCODE='22023'; END IF;
  v_server:=public.calculate_club_payroll(p_club_id,p_start_date,p_end_date)->'dealers';
  IF v_server IS NULL OR jsonb_typeof(v_server)<>'object' THEN
    RAISE EXCEPTION 'payroll_source_unavailable' USING ERRCODE='22023';END IF;
  FOR v_id,v_expected IN SELECT key,value FROM jsonb_each(v_server) ORDER BY key LOOP
    IF jsonb_typeof(v_expected)<>'object' OR v_expected->>'dealer_id' IS DISTINCT FROM v_id OR v_expected ? 'error' THEN
      RAISE EXCEPTION 'payroll_source_incomplete' USING ERRCODE='22023';END IF;
  END LOOP;
  IF jsonb_array_length(p_payroll_rows)<>(SELECT count(*) FROM jsonb_object_keys(v_server)) THEN
    RAISE EXCEPTION 'payroll_roster_changed' USING ERRCODE='22023';END IF;
  FOR v_client IN SELECT value FROM jsonb_array_elements(p_payroll_rows) LOOP
    v_id:=v_client->>'dealer_id';
    IF v_id IS NULL OR v_id=ANY(v_ids) OR NOT v_server ? v_id THEN
      RAISE EXCEPTION 'payroll_dealer_identity_conflict' USING ERRCODE='22023';END IF;
    v_ids:=array_append(v_ids,v_id);v_expected:=v_server->v_id;
    IF EXISTS(SELECT 1 FROM unnest(v_keys) k WHERE COALESCE(v_client->k,'null'::jsonb) IS DISTINCT FROM COALESCE(v_expected->k,'null'::jsonb)) THEN
      RAISE EXCEPTION 'payroll_source_changed_refresh_required' USING ERRCODE='22023';END IF;
    v_server_rows:=v_server_rows||jsonb_build_array(v_expected);
  END LOOP;
  -- The existing writer consumes server rows, never the browser money snapshot.
  p_payroll_rows:=v_server_rows;
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id AND period_year = p_year AND period_month = p_month
  FOR UPDATE;

  IF v_period_id IS NULL THEN
    INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
    VALUES (p_club_id, p_year, p_month, p_start_date, p_end_date, 'draft', p_user_id)
    RETURNING id INTO v_period_id;
  ELSE
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = v_period_id AND status IN ('locked','payment_prepared','paid','reconciled')) THEN
      RAISE EXCEPTION 'Payroll period is locked or in payment lifecycle and cannot be modified. Period ID: %', v_period_id;
    END IF;
    UPDATE payroll_periods SET calculated_by = p_user_id, updated_at = now() WHERE id = v_period_id;
  END IF;

  -- B7: SERVER RECOMPUTE ON SAVE - client-supplied amounts are IGNORED.
  -- The payload only selects WHICH dealers to include (roster); every stored
  -- number comes from calculate_dealer_payroll() server-side at save instant.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
    v_dealer_id := (v_row->>'dealer_id')::UUID;

    -- roster guard: dealer must belong to this club and be active
    IF NOT EXISTS (
      SELECT 1 FROM dealers d
      WHERE d.id = v_dealer_id AND d.club_id = p_club_id AND d.status = 'active'
    ) THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    v_calc := calculate_dealer_payroll(v_dealer_id, p_start_date, p_end_date);
    IF v_calc ? 'error' THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    -- client-vs-server drift accounting for the audit trail
    v_client_gross := v_client_gross + COALESCE(NULLIF(v_row->>'gross_pay_vnd','')::NUMERIC, 0)::BIGINT;
    v_client_net   := v_client_net   + COALESCE(NULLIF(v_row->>'net_pay_vnd','')::NUMERIC, 0)::BIGINT;
    v_server_gross := v_server_gross + COALESCE((v_calc->>'gross_pay_vnd')::NUMERIC, 0)::BIGINT;
    v_server_net   := v_server_net   + COALESCE((v_calc->>'net_pay_vnd')::NUMERIC, 0)::BIGINT;

    INSERT INTO dealer_payroll (
      dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
      hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
      ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
      total_adjustments_vnd, tips_amount_vnd, bhxh_deduction_vnd,
      bhyt_deduction_vnd, bhtn_deduction_vnd, pit_deduction_vnd,
      net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
    ) VALUES (
      v_dealer_id, p_club_id, v_period_id,
      v_calc->>'employment_type',
      (v_calc->>'monthly_salary_vnd')::NUMERIC,
      (v_calc->>'hourly_rate_vnd')::NUMERIC,
      (v_calc->>'ot_multiplier')::NUMERIC,
      (v_calc->>'total_shifts')::INT,
      (v_calc->>'total_hours')::NUMERIC,
      (v_calc->>'regular_hours')::NUMERIC,
      (v_calc->>'ot_hours')::NUMERIC,
      (v_calc->>'base_salary_vnd')::NUMERIC,
      (v_calc->>'regular_pay_vnd')::NUMERIC,
      (v_calc->>'ot_pay_vnd')::NUMERIC,
      (v_calc->>'gross_pay_vnd')::NUMERIC,
      (v_calc->>'total_adjustments_vnd')::NUMERIC,
      COALESCE((v_calc->>'tips_amount_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhxh_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhyt_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhtn_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'pit_deduction_vnd')::NUMERIC, 0)::BIGINT,
      (v_calc->>'net_pay_vnd')::NUMERIC,
      COALESCE((v_calc->>'net_pay_after_tax_vnd')::NUMERIC, (v_calc->>'net_pay_vnd')::NUMERIC)::BIGINT,
      'pending', p_user_id
    )
    ON CONFLICT (period_id, dealer_id) DO UPDATE SET
      employment_type = EXCLUDED.employment_type,
      monthly_salary_vnd = EXCLUDED.monthly_salary_vnd,
      hourly_rate_vnd = EXCLUDED.hourly_rate_vnd,
      ot_multiplier = EXCLUDED.ot_multiplier,
      total_shifts = EXCLUDED.total_shifts,
      total_hours = EXCLUDED.total_hours,
      regular_hours = EXCLUDED.regular_hours,
      ot_hours = EXCLUDED.ot_hours,
      base_salary_vnd = EXCLUDED.base_salary_vnd,
      regular_pay_vnd = EXCLUDED.regular_pay_vnd,
      ot_pay_vnd = EXCLUDED.ot_pay_vnd,
      gross_pay_vnd = EXCLUDED.gross_pay_vnd,
      total_adjustments_vnd = EXCLUDED.total_adjustments_vnd,
      tips_amount_vnd = EXCLUDED.tips_amount_vnd,
      bhxh_deduction_vnd = EXCLUDED.bhxh_deduction_vnd,
      bhyt_deduction_vnd = EXCLUDED.bhyt_deduction_vnd,
      bhtn_deduction_vnd = EXCLUDED.bhtn_deduction_vnd,
      pit_deduction_vnd = EXCLUDED.pit_deduction_vnd,
      net_pay_vnd = EXCLUDED.net_pay_vnd,
      net_pay_after_tax_vnd = EXCLUDED.net_pay_after_tax_vnd,
      status = EXCLUDED.status,
      calculated_by = EXCLUDED.calculated_by,
      updated_at = now();
    v_rows_saved := v_rows_saved + 1;
  END LOOP;

  -- Soft-delete: mark excluded instead of hard delete
  -- Preserves adjustments linked to excluded dealer rows
  UPDATE dealer_payroll
  SET status = 'excluded', updated_at = now()
  WHERE period_id = v_period_id
    AND dealer_id NOT IN (
      SELECT (elem->>'dealer_id')::UUID
      FROM jsonb_array_elements(p_payroll_rows) AS elem
    );

  -- B7: audit the save with client-vs-server drift evidence
  INSERT INTO payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) VALUES (
    'payroll_periods', v_period_id, p_club_id, 'UPDATE',
    jsonb_build_object('client_gross_total', v_client_gross, 'client_net_total', v_client_net),
    jsonb_build_object('server_gross_total', v_server_gross, 'server_net_total', v_server_net,
                       'rows_saved', v_rows_saved, 'rows_skipped', v_rows_skipped),
    p_user_id, 'B7 server recompute on save'
  );

  RETURN v_period_id;
END;
$function$
;
COMMIT;

