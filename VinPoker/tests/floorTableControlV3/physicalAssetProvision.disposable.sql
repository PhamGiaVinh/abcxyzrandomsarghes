\set ON_ERROR_STOP on
-- Run after the existing Floor server-contract disposable schema, never live.
-- Match the observed production game type and administrator helper baseline.
ALTER TABLE public.game_tables ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT 'NLH';
CREATE OR REPLACE FUNCTION public.is_club_admin(p_user_id uuid, p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.clubs WHERE id=p_club_id AND owner_id=p_user_id)
$$;
\ir ../../supabase/migrations/20270128000063_floor_physical_asset_provision_v1.sql

SELECT public.floor_table_v3_assert(
  has_function_privilege('authenticated','public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)','EXECUTE')
  AND pg_catalog.to_regprocedure('public.declare_club_physical_table_v1(uuid,integer,uuid)') IS NULL,
  'physical declaration has authenticated-only grant');
SET ROLE anon;
SELECT public.floor_table_v3_assert_permission_denied(
  $$SELECT public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000010',91,
    '00000000-0000-0000-0000-000000006399','00000000-0000-0000-0000-000000000003')$$);
RESET ROLE;
SET ROLE service_role;
SELECT public.floor_table_v3_assert_permission_denied(
  $$SELECT public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000010',91,
    '00000000-0000-0000-0000-000000006399','00000000-0000-0000-0000-000000000003')$$);
RESET ROLE;

CREATE TEMP TABLE physical_asset_before AS
SELECT id,to_jsonb(g) AS payload FROM public.game_tables g;
CREATE TEMP TABLE physical_operation_counts_before AS
SELECT (SELECT count(*) FROM public.table_sessions) AS sessions,
  (SELECT count(*) FROM public.dealer_assignments) AS assignments,
  (SELECT count(*) FROM public.tournament_seats) AS seats,
  (SELECT count(*) FROM public.tournament_entries) AS entries;
CREATE TEMP TABLE physical_operation_payloads_before AS
SELECT jsonb_build_object(
  'sessions', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM public.table_sessions s),
  'assignments', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.dealer_assignments a),
  'seats', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM public.tournament_seats s),
  'entries', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb) FROM public.tournament_entries e)
) AS payload;

INSERT INTO public.club_cashiers(club_id,user_id)
VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000006390');

-- Exercise actual authenticated grant rather than only superuser invocation.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',false);
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',91,'00000000-0000-0000-0000-000000006300',auth.uid())
  ->>'error'='unauthorized','absent authenticated actor fails closed');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000006390',false);
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',91,'00000000-0000-0000-0000-000000006300',auth.uid())
  ->>'error'='actor_not_allowed','Cashier authority alone cannot declare assets');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
SELECT public.floor_table_v3_assert(
  public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000010',91,
    '00000000-0000-0000-0000-000000006301',auth.uid())->>'error'='actor_not_allowed',
  'Floor authority alone must not declare assets');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',90,'00000000-0000-0000-0000-000000006310',
  '00000000-0000-0000-0000-000000000003')->>'error'='ACTOR_CHANGED',
  'new authorized same-club account cannot commit an old actor intent');
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',90,'00000000-0000-0000-0000-000000006311',NULL)
  ->>'error'='ACTOR_CHANGED','missing actor fence cannot bypass the new contract');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
SELECT public.floor_table_v3_assert(
  public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000011',91,
    '00000000-0000-0000-0000-000000006302',auth.uid())->>'error'='actor_not_allowed',
  'dealer control cannot cross clubs');
SELECT public.floor_table_v3_assert(
  public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000010',NULL,
    '00000000-0000-0000-0000-000000006303',auth.uid())->>'error'='invalid_table_number'
  AND public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000010',101,
    '00000000-0000-0000-0000-000000006303',auth.uid())->>'error'='invalid_table_number',
  'null and out-of-range table numbers fail closed');
DO $$
DECLARE v_result jsonb; v_replay jsonb;
BEGIN
  v_result:=public.declare_club_physical_table_v1(
    '00000000-0000-0000-0000-000000000010',91,'00000000-0000-0000-0000-000000006304',auth.uid());
  PERFORM public.floor_table_v3_assert(v_result->>'ok'='true'
    AND v_result->>'status'='inactive' AND v_result->>'operational_status'='available',
    'declaration creates an inactive available asset, not a session');
  v_replay:=public.declare_club_physical_table_v1(
    '00000000-0000-0000-0000-000000000010',91,'00000000-0000-0000-0000-000000006304',auth.uid());
  PERFORM public.floor_table_v3_assert(v_replay=v_result,'same receipt replays immutable original asset');
  PERFORM public.floor_table_v3_assert(public.declare_club_physical_table_v1(
    '00000000-0000-0000-0000-000000000010',92,'00000000-0000-0000-0000-000000006304',auth.uid())
    ->>'error'='IDEMPOTENCY_CONFLICT','same key different number conflicts');
  PERFORM public.floor_table_v3_assert(public.declare_club_physical_table_v1(
    '00000000-0000-0000-0000-000000000010',91,'00000000-0000-0000-0000-000000006305',auth.uid())
    ->>'error'='table_number_taken','different request cannot adopt an existing asset');
END;
$$;
RESET ROLE;

SELECT public.floor_table_v3_assert(
  NOT EXISTS(SELECT 1 FROM public.game_tables WHERE club_id='00000000-0000-0000-0000-000000000010' AND table_number=90)
  AND NOT EXISTS(SELECT 1 FROM public.table_operation_receipts
    WHERE request_id IN ('00000000-0000-0000-0000-000000006310','00000000-0000-0000-0000-000000006311')),
  'actor mismatch created neither asset nor receipt');

-- Receipt replay must reauthorize instead of disclosing an old privileged result.
DELETE FROM public.club_dealer_controls WHERE club_id='00000000-0000-0000-0000-000000000010'
  AND user_id='00000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',91,'00000000-0000-0000-0000-000000006304',auth.uid())
  ->>'error'='actor_not_allowed','revoked actor cannot retrieve a saved asset receipt');
RESET ROLE;
INSERT INTO public.club_dealer_controls(club_id,user_id)
VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003');

SELECT public.floor_table_v3_assert(
  (SELECT count(*) FROM public.game_tables)=(SELECT count(*)+1 FROM physical_asset_before)
  AND NOT EXISTS (SELECT 1 FROM physical_asset_before b
    LEFT JOIN public.game_tables g ON g.id=b.id WHERE to_jsonb(g) IS DISTINCT FROM b.payload)
  AND (SELECT count(*) FROM public.table_operation_receipts
    WHERE operation_type='declare_physical_table_v1')=1,
  'one asset and receipt only; all original physical assets unchanged');
SELECT public.floor_table_v3_assert(
  NOT EXISTS (SELECT 1 FROM physical_operation_counts_before b WHERE
    b.sessions<>(SELECT count(*) FROM public.table_sessions)
    OR b.assignments<>(SELECT count(*) FROM public.dealer_assignments)
    OR b.seats<>(SELECT count(*) FROM public.tournament_seats)
    OR b.entries<>(SELECT count(*) FROM public.tournament_entries)),
  'declaration does not open sessions or mutate participation/dealers');
SELECT public.floor_table_v3_assert((SELECT payload FROM physical_operation_payloads_before)
  = jsonb_build_object(
    'sessions', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM public.table_sessions s),
    'assignments', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.dealer_assignments a),
    'seats', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM public.tournament_seats s),
    'entries', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb) FROM public.tournament_entries e)),
  'all original session/assignment/seat/entry payloads remain identical, not just counts');

-- Legacy name collision is not an invitation to fill NULL identity fields.
INSERT INTO public.game_tables(club_id,table_name,status)
VALUES ('00000000-0000-0000-0000-000000000010','Bàn 92','inactive');
SET ROLE authenticated;
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',92,'00000000-0000-0000-0000-000000006306',auth.uid())
  ->>'error'='table_number_taken','legacy named asset is not adopted or renumbered');
RESET ROLE;
SELECT public.floor_table_v3_assert((SELECT count(*)=1 AND bool_and(table_number IS NULL)
  FROM public.game_tables WHERE club_id='00000000-0000-0000-0000-000000000010' AND table_name='Bàn 92'),
  'legacy named asset remains unchanged');

CREATE FUNCTION public.physical_asset_test_receipt_fault() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.operation_type='declare_physical_table_v1'
    AND NEW.request_id='00000000-0000-0000-0000-000000006307' THEN
    RAISE EXCEPTION 'TEST_PHYSICAL_RECEIPT_FAILURE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER physical_asset_test_receipt_fault BEFORE INSERT ON public.table_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.physical_asset_test_receipt_fault();
DO $$ BEGIN
  BEGIN
    PERFORM public.declare_club_physical_table_v1('00000000-0000-0000-0000-000000000010',95,
      '00000000-0000-0000-0000-000000006307',auth.uid());
    RAISE EXCEPTION 'expected receipt fault';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TEST_PHYSICAL_RECEIPT_FAILURE' THEN RAISE; END IF;
  END;
  PERFORM public.floor_table_v3_assert(
    NOT EXISTS(SELECT 1 FROM public.game_tables WHERE club_id='00000000-0000-0000-0000-000000000010' AND table_number=95)
    AND NOT EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id='00000000-0000-0000-0000-000000006307'),
    'receipt failure rolls back the asset as one atomic operation');
END $$;
DROP TRIGGER physical_asset_test_receipt_fault ON public.table_operation_receipts;
DROP FUNCTION public.physical_asset_test_receipt_fault();
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',96,'00000000-0000-0000-0000-000000006308',auth.uid())
  ->>'ok'='true','existing club-admin authority can declare an asset');
RESET ROLE;
-- Exercise trusted helper's super-admin branch separately from client metadata.
-- This is a synthetic role fixture, not a production has_role parity claim.
CREATE TABLE public.physical_asset_test_roles(user_id uuid, role public.app_role);
INSERT INTO public.physical_asset_test_roles VALUES
  ('00000000-0000-0000-0000-000000006391','super_admin');
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid,p_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.physical_asset_test_roles WHERE user_id=p_user_id AND role=p_role)
$$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000006391',false);
SELECT public.floor_table_v3_assert(public.declare_club_physical_table_v1(
  '00000000-0000-0000-0000-000000000010',97,'00000000-0000-0000-0000-000000006309',auth.uid())
  ->>'ok'='true','trusted server super-admin helper permits declaration');
RESET ROLE;
-- Reproduce the observed live direct INSERT policy/number uniqueness for the
-- alternate-writer race below. The synthetic role helpers are still fixtures,
-- not a claim of complete live schema parity.
ALTER TABLE public.game_tables ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.game_tables TO authenticated;
GRANT SELECT ON public.clubs, public.club_dealer_controls, public.physical_asset_test_roles TO authenticated;
CREATE POLICY physical_asset_test_select ON public.game_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY physical_asset_test_insert ON public.game_tables FOR INSERT TO authenticated
WITH CHECK (public.is_club_dealer_control(auth.uid(),club_id)
  OR public.has_role(auth.uid(),'super_admin'::public.app_role)
  OR public.is_club_admin(auth.uid(),club_id));
SELECT 'PHYSICAL_ASSET_PROVISION_DISPOSABLE_PASS' AS result;
