\set ON_ERROR_STOP on
-- Local disposable PostgreSQL only. Existing Floor bootstrap supplies receipts.
\ir ../floorTableControlV3/disposableDb.serverContract.sql
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')::text
$$;
CREATE FUNCTION public.is_club_admin(p_user_id uuid,p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.clubs WHERE id=p_club_id AND owner_id=p_user_id)
$$;
ALTER TABLE public.clubs ALTER COLUMN owner_id DROP NOT NULL;
UPDATE public.clubs SET owner_id=NULL WHERE id='00000000-0000-0000-0000-000000000010';
CREATE TABLE public.club_settings(club_id uuid PRIMARY KEY REFERENCES public.clubs,
  auto_swing_enabled boolean DEFAULT true,policy_marker text NOT NULL DEFAULT 'unchanged TEST policy');
INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES
  ('00000000-0000-0000-0000-000000000010',true),('00000000-0000-0000-0000-000000000020',false);
ALTER TABLE public.club_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.club_settings TO authenticated;
GRANT SELECT ON public.clubs TO authenticated;
CREATE POLICY stop_test_select ON public.club_settings FOR SELECT TO authenticated USING(true);
CREATE POLICY club_settings_insert_owner ON public.club_settings FOR INSERT TO authenticated
  WITH CHECK(public.is_club_admin(auth.uid(),club_id) OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY club_settings_update_owner_super ON public.club_settings FOR UPDATE TO authenticated
  USING(public.is_club_admin(auth.uid(),club_id) OR public.has_role(auth.uid(),'super_admin'));

-- Exact web counterexample: assigned control cannot use the generic upsert.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.floor_table_v3_assert_permission_denied($$
  INSERT INTO public.club_settings(club_id,auto_swing_enabled)
  VALUES('00000000-0000-0000-0000-000000000010',false)
  ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=false
$$);
RESET ROLE;
\ir ../../supabase/migrations/20270128000064_dealer_swing_scoped_stop_v1.sql
SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated','public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)','EXECUTE'),
  'Stop capability is authenticated-only');
CREATE TEMP TABLE stop_operational_before AS SELECT jsonb_build_object(
  'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.table_sessions s),
  'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.dealer_assignments a),
  'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.tournament_entries e),
  'seats',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.tournament_seats s)) AS payload;
SET ROLE anon;
SELECT public.floor_table_v3_assert_permission_denied($$SELECT public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400','00000000-0000-0000-0000-000000000003')$$);
RESET ROLE;
SET ROLE service_role;
SELECT public.floor_table_v3_assert_permission_denied($$SELECT public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400','00000000-0000-0000-0000-000000000003')$$);
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400',auth.uid())->>'error'='unauthorized',
  'unexpected JWT role cannot enter through an inherited grant');
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','',false);
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400',NULL)->>'error'='unauthorized',
  'missing actor cannot write even with authenticated JWT role');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400',
  '00000000-0000-0000-0000-000000000099')->>'error'='ACTOR_CHANGED','expected actor is a CAS fence, not authority');
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400',NULL)->>'error'='ACTOR_CHANGED',
  'missing actor fence cannot bypass contract');
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000006400',auth.uid())->>'error'='actor_not_allowed',
  'control membership does not cross clubs');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006400',auth.uid())->>'error'='actor_not_allowed',
  'Floor alone cannot claim Dealer Control authority');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010',NULL,auth.uid())->>'error'='invalid_request','missing request fails closed');
DO $$ DECLARE v_first jsonb; v_replay jsonb; BEGIN
  v_first:=public.operator_stop_dealer_swing_v1('00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000006401',auth.uid());
  PERFORM public.floor_table_v3_assert(v_first->>'ok'='true'
    AND v_first#>>'{receipt,outcome}'='applied' AND v_first#>>'{current_state,auto_swing_enabled}'='false',
    'assigned control can stop ON even without club owner');
  v_replay:=public.operator_stop_dealer_swing_v1('00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000006401',auth.uid());
  PERFORM public.floor_table_v3_assert(v_first=v_replay,'same receipt and unchanged current state replay exactly');
END $$;
RESET ROLE;
SELECT public.floor_table_v3_assert((SELECT NOT auto_swing_enabled AND policy_marker='unchanged TEST policy'
  FROM public.club_settings WHERE club_id='00000000-0000-0000-0000-000000000010'),
  'only intended flag changes; no unrelated policy defaults');
CREATE TEMP TABLE stop_original_receipt AS SELECT result FROM public.table_operation_receipts
  WHERE operation_type='operator_stop_swing_v1' AND request_id='00000000-0000-0000-0000-000000006401';
UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='00000000-0000-0000-0000-000000000010';
SET ROLE authenticated;
DO $$ DECLARE v_replay jsonb; BEGIN
  v_replay:=public.operator_stop_dealer_swing_v1('00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000006401',auth.uid());
  PERFORM public.floor_table_v3_assert(v_replay#>>'{receipt,auto_swing_enabled}'='false'
    AND v_replay#>>'{current_state,auto_swing_enabled}'='true','historical OFF is separate from current ON');
END $$;
RESET ROLE;
SELECT public.floor_table_v3_assert((SELECT auto_swing_enabled FROM public.club_settings
  WHERE club_id='00000000-0000-0000-0000-000000000010')
  AND (SELECT r.result=b.result FROM public.table_operation_receipts r CROSS JOIN stop_original_receipt b
    WHERE r.operation_type='operator_stop_swing_v1' AND r.request_id='00000000-0000-0000-0000-000000006401'),
  'receipt recovery never stops a newer ON or rewrites history');
INSERT INTO public.club_dealer_controls(club_id,user_id)
  VALUES('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003');
SET ROLE authenticated;
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000006401',auth.uid())->>'error'='IDEMPOTENCY_CONFLICT',
  'same actor/key different authorized club conflicts');
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006402',auth.uid())
  #>>'{current_state,auto_swing_enabled}'='false','new explicit intent can stop newer ON');
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006403',auth.uid())
  #>>'{receipt,outcome}'='unchanged','new stop while already OFF never turns ON');
RESET ROLE;
DELETE FROM public.club_dealer_controls WHERE club_id='00000000-0000-0000-0000-000000000010'
  AND user_id='00000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006401',auth.uid())->>'error'='actor_not_allowed',
  'revoked control cannot recover receipt');
RESET ROLE;
INSERT INTO public.club_dealer_controls(club_id,user_id)
  VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003');
INSERT INTO public.clubs(id,owner_id) VALUES('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000003');
SET ROLE authenticated;
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000006404',auth.uid())->>'error'='settings_missing',
  'missing settings must not initialize unrelated defaults');
RESET ROLE;
SELECT public.floor_table_v3_assert(NOT EXISTS(SELECT 1 FROM public.club_settings
  WHERE club_id='00000000-0000-0000-0000-000000000030'),'no settings created');
INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('00000000-0000-0000-0000-000000000030',NULL);
SET ROLE authenticated;
SELECT public.floor_table_v3_assert(public.operator_stop_dealer_swing_v1(
  '00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000006404',auth.uid())->>'error'='settings_unverified',
  'malformed NULL is not OFF');
RESET ROLE;
SELECT public.floor_table_v3_assert((SELECT payload FROM stop_operational_before)=jsonb_build_object(
  'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.table_sessions s),
  'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.dealer_assignments a),
  'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.tournament_entries e),
  'seats',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.tournament_seats s)),
  'Stop never changes sessions, assignments, entries or seats');
SELECT public.floor_table_v3_assert((SELECT count(*)=3 FROM public.table_operation_receipts
  WHERE operation_type='operator_stop_swing_v1'),'only three intended Stop receipts');
-- General settings permissions remain unchanged after the new capability.
SET ROLE authenticated;
WITH attempted AS (
  UPDATE public.club_settings SET policy_marker='unauthorized TEST change'
  WHERE club_id='00000000-0000-0000-0000-000000000010' RETURNING 1)
SELECT public.floor_table_v3_assert((SELECT count(*)=0 FROM attempted),
  'scoped OFF capability does not permit unrelated settings writes');
RESET ROLE;
UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='00000000-0000-0000-0000-000000000010';
CREATE FUNCTION public.stop_test_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.operation_type='operator_stop_swing_v1' AND NEW.request_id='00000000-0000-0000-0000-000000006408' THEN
    RAISE EXCEPTION 'TEST_STOP_RECEIPT_FAILURE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stop_test_reject_receipt BEFORE INSERT ON public.table_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.stop_test_reject_receipt();
DO $$ BEGIN
  BEGIN
    PERFORM public.operator_stop_dealer_swing_v1('00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000006408','00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'expected receipt failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'TEST_STOP_RECEIPT_FAILURE' THEN RAISE; END IF;
  END;
  PERFORM public.floor_table_v3_assert((SELECT auto_swing_enabled FROM public.club_settings
    WHERE club_id='00000000-0000-0000-0000-000000000010')
    AND NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='00000000-0000-0000-0000-000000006408'),
    'failed receipt insertion rolls back OFF and receipt together');
END $$;
DROP TRIGGER stop_test_reject_receipt ON public.table_operation_receipts;
DROP FUNCTION public.stop_test_reject_receipt();
SELECT 'SCOPED_SWING_STOP_DISPOSABLE_PASS' AS result;
