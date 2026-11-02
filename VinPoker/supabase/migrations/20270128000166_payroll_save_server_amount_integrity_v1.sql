-- CLI candidate20261018184735 -> local forward166. NOT LIVE.
-- Recovery: suspend both save entrypoints; never restore client-owned money.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE target regprocedure:='public.save_payroll_period(uuid,integer,integer,date,date,jsonb,uuid)'::regprocedure;
 original text; body text; patched text; definition text; anchor integer; acl aclitem[];
BEGIN
 SELECT prosrc,proacl INTO original,acl FROM pg_proc WHERE oid=target;
 body:=replace(original,chr(13),'');
 IF current_user<>'postgres' OR md5(body)<>'9d9c0b3887d9bb867674ab529f8e3181'
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=target)<>'postgres'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_payroll_period_secure(uuid,integer,integer,date,date,jsonb)'::regprocedure)<>'b126c8216ad7f409d0e3cbfc097a964f'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.calculate_club_payroll(uuid,date,date)'::regprocedure)<>'567b2e6bbe069ca294bc8e81cc6b8416'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000166') THEN
   RAISE EXCEPTION 'payroll166_catalog_drift_or_collision';END IF;
 anchor:=position(E'\nBEGIN\n' IN body);
 IF anchor=0 THEN RAISE EXCEPTION 'payroll166_body_anchor_missing';END IF;
 patched:=left(body,anchor-1)||$guard$
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
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2200 OR p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 THEN
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
$guard$||substring(body FROM anchor+length(E'\nBEGIN\n'));
 definition:=pg_get_functiondef(target);
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'payroll166_definition_drift';END IF;
 EXECUTE replace(definition,original,patched);
 IF (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM patched
 OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN
   RAISE EXCEPTION 'payroll166_body_or_acl_postcheck';END IF;
END $patch$;
COMMIT;
