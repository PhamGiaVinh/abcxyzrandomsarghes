\set ON_ERROR_STOP on
-- Exact retained schema, real authorization/receipt helpers, local PG17 only.
-- Install migration63 separately before this transaction; all fixtures roll back.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'vinpoker_ops_asset63_%'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'local_asset63_pg17_database_required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_asset(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'asset63_current_schema: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES
 ('63000000-0000-4000-8000-000000000001'),
 ('63000000-0000-4000-8000-000000000002'),
 ('63000000-0000-4000-8000-000000000003'),
 ('63000000-0000-4000-8000-000000000004');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('63000000-0000-4000-8000-000000000010',NULL,'Asset Control TEST','TEST'),
 ('63000000-0000-4000-8000-000000000020','63000000-0000-4000-8000-000000000002','Asset Owner TEST','TEST');
INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES
 ('63000000-0000-4000-8000-000000000010','63000000-0000-4000-8000-000000000001');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('63000000-0000-4000-8000-000000000003','super_admin');
-- Real club trigger creates 100 legacy NULL-number assets. First prove these
-- cannot be adopted, then vacate exactly three unused synthetic fixture names.
-- This is fixture preparation inside the rollback transaction, never live repair.
SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert_asset(public.declare_club_physical_table_v1(
 '63000000-0000-4000-8000-000000000010',21,'63000000-0000-4000-8000-000000000100',auth.uid())
 ->>'error'='table_number_taken','legacy same-name NULL-number asset is not adopted');
DELETE FROM public.game_tables WHERE table_number IS NULL AND
 ((club_id='63000000-0000-4000-8000-000000000010' AND table_name IN ('Bàn 21','Bàn 22'))
 OR (club_id='63000000-0000-4000-8000-000000000020' AND table_name='Bàn 21'));
CREATE TEMP TABLE asset_operations_before AS SELECT jsonb_build_object(
 'sessions',(SELECT count(*) FROM public.table_sessions),
 'assignments',(SELECT count(*) FROM public.dealer_assignments),
 'seats',(SELECT count(*) FROM public.tournament_seats),
 'entries',(SELECT count(*) FROM public.tournament_entries)) AS payload;
SELECT pg_temp.assert_asset((SELECT p.proowner='postgres'::regrole AND p.prosecdef
 AND p.proconfig=ARRAY['search_path=""']::text[]
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
 FROM pg_proc p WHERE p.oid='public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)'::regprocedure),
 'owner, definer, path and grants');
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000010',21,
 '63000000-0000-4000-8000-000000000101','63000000-0000-4000-8000-000000000001')::text AS payload \gset control_
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000010',21,
 '63000000-0000-4000-8000-000000000101','63000000-0000-4000-8000-000000000001')::text AS payload \gset replay_
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000010',22,
 '63000000-0000-4000-8000-000000000101','63000000-0000-4000-8000-000000000001')::text AS payload \gset conflict_
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000020',21,
 '63000000-0000-4000-8000-000000000102','63000000-0000-4000-8000-000000000001')::text AS payload \gset cross_
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000010',22,
 '63000000-0000-4000-8000-000000000103','63000000-0000-4000-8000-000000000002')::text AS payload \gset stale_
RESET ROLE;
SELECT pg_temp.assert_asset(:'control_payload'::jsonb->>'ok'='true','assigned control can declare without owner');
SELECT pg_temp.assert_asset(:'replay_payload'::jsonb=:'control_payload'::jsonb,'same key identical receipt');
SELECT pg_temp.assert_asset(:'conflict_payload'::jsonb->>'error'='IDEMPOTENCY_CONFLICT','same key different number conflicts');
SELECT pg_temp.assert_asset(:'cross_payload'::jsonb->>'error'='actor_not_allowed','no cross-club authority');
SELECT pg_temp.assert_asset(:'stale_payload'::jsonb->>'error'='ACTOR_CHANGED','expected actor is not authority');
SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000020',21,
 '63000000-0000-4000-8000-000000000104','63000000-0000-4000-8000-000000000002')::text AS payload \gset owner_
RESET ROLE;
SELECT pg_temp.assert_asset(:'owner_payload'::jsonb->>'ok'='true','existing owner authority retained');
SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000010',22,
 '63000000-0000-4000-8000-000000000105','63000000-0000-4000-8000-000000000003')::text AS payload \gset admin_
RESET ROLE;
SELECT pg_temp.assert_asset(:'admin_payload'::jsonb->>'ok'='true','trusted super-admin authority retained');
SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"user_metadata":{"role":"super_admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT public.declare_club_physical_table_v1('63000000-0000-4000-8000-000000000010',23,
 '63000000-0000-4000-8000-000000000106','63000000-0000-4000-8000-000000000004')::text AS payload \gset forged_
RESET ROLE;
SELECT pg_temp.assert_asset(:'forged_payload'::jsonb->>'error'='actor_not_allowed','user metadata cannot grant access');
SELECT pg_temp.assert_asset((SELECT count(*)=3 FROM public.game_tables
 WHERE club_id IN ('63000000-0000-4000-8000-000000000010','63000000-0000-4000-8000-000000000020')
 AND status='inactive' AND operational_status='available' AND table_number IN (21,22)),
 'exact three inactive assets, no extra retry allocation');
SELECT pg_temp.assert_asset((SELECT payload FROM asset_operations_before)=jsonb_build_object(
 'sessions',(SELECT count(*) FROM public.table_sessions),
 'assignments',(SELECT count(*) FROM public.dealer_assignments),
 'seats',(SELECT count(*) FROM public.tournament_seats),
 'entries',(SELECT count(*) FROM public.tournament_entries)), 'no operational lifecycle writes');
ROLLBACK;
SELECT 'PHYSICAL_ASSET_EXACT_CURRENT_SCHEMA_ROLES_RECEIPTS_PASS' AS result;
