-- CLI candidate 20261018092905; reserved local forward140, NOT LIVE.
-- Keep the calculator private to existing server-owned payroll wrappers.
-- Preserve existing default26 for both NULL setting and absent settings row.
-- No saved payroll, money, rate, break, OT, tax or history mutations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE target regprocedure:='public.calculate_dealer_payroll(uuid,date,date,integer)'::regprocedure;
 original text; replacement text; definition text; body text;
 needle text:=$old$  SELECT COALESCE(standard_shifts_per_month, 26) INTO v_standard_shifts
  FROM public.club_settings
  WHERE club_id = v_dealer.club_id;$old$;
 substituted text:=$new$  SELECT COALESCE((SELECT standard_shifts_per_month
    FROM public.club_settings WHERE club_id = v_dealer.club_id), 26)
  INTO v_standard_shifts;$new$;
BEGIN
 SELECT prosrc INTO original FROM pg_proc WHERE oid=target;
 IF current_user<>'postgres' OR md5(original)<>'768e38563eb1385b7953a91649b59f60'
  OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=target)<>'postgres'
  OR (SELECT proconfig FROM pg_proc WHERE oid=target) IS DISTINCT FROM ARRAY['search_path=public']::text[]
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.calculate_club_payroll(uuid,date,date)'::regprocedure)<>'911db1f308e78a06f940a0c80fb850fc' THEN
  RAISE EXCEPTION 'payroll140_reviewed_baseline_drift';END IF;
 IF length(original)-length(replace(original,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'payroll140_default_anchor_drift';END IF;
 replacement:=replace(original,needle,substituted);
 definition:=pg_get_functiondef(target);
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'payroll140_definition_drift';END IF;
 EXECUTE replace(definition,original,replacement);
 SELECT prosrc INTO body FROM pg_proc WHERE oid=target;
 IF body IS DISTINCT FROM replacement THEN RAISE EXCEPTION 'payroll140_source_postcheck_failed';END IF;
END;
$patch$;
REVOKE ALL ON FUNCTION public.calculate_dealer_payroll(uuid,date,date,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF has_function_privilege('anon','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE')
  OR has_function_privilege('service_role','public.calculate_dealer_payroll(uuid,date,date,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'payroll140_direct_calculator_still_exposed';END IF;
 IF NOT has_function_privilege('authenticated','public.calculate_club_payroll(uuid,date,date)','EXECUTE') THEN
  RAISE EXCEPTION 'payroll140_wrapper_unavailable';END IF;
END $$;
COMMIT;
