\set ON_ERROR_STOP on
-- Exact sanitized current schema restored into a dedicated local PG17 DB.
-- No helper/RLS replacement. All fixture data and calls roll back together.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'vinpoker_ops_stop64_%'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'local_stop64_pg17_database_required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_stop(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'stop64_current_schema: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES
 ('64000000-0000-4000-8000-000000000001'),
 ('64000000-0000-4000-8000-000000000002'),
 ('64000000-0000-4000-8000-000000000003'),
 ('64000000-0000-4000-8000-000000000004');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('64000000-0000-4000-8000-000000000010',NULL,'Scoped Stop Control TEST','TEST'),
 ('64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000002','Scoped Stop Owner TEST','TEST'),
 ('64000000-0000-4000-8000-000000000030',NULL,'Missing settings TEST','TEST');
INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES
 ('64000000-0000-4000-8000-000000000010','64000000-0000-4000-8000-000000000001'),
 ('64000000-0000-4000-8000-000000000030','64000000-0000-4000-8000-000000000002');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('64000000-0000-4000-8000-000000000003','super_admin');
INSERT INTO public.club_settings(club_id,auto_swing_enabled,shortage_notify_telegram) VALUES
 ('64000000-0000-4000-8000-000000000010',true,false),
 ('64000000-0000-4000-8000-000000000020',true,false);
CREATE TEMP TABLE stop_settings_before AS SELECT club_id,to_jsonb(s)-'auto_swing_enabled' AS payload
 FROM public.club_settings s WHERE club_id IN ('64000000-0000-4000-8000-000000000010','64000000-0000-4000-8000-000000000020');
SELECT pg_temp.assert_stop((SELECT p.proowner='postgres'::regrole AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=""','lock_timeout=5s']::text[]
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
  AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  FROM pg_proc p WHERE p.oid='public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)'::regprocedure),
  'exact owner, definer, search path, timeout and grants');
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000010',
 '64000000-0000-4000-8000-000000000101','64000000-0000-4000-8000-000000000001')::text AS payload \gset control_
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000020',
 '64000000-0000-4000-8000-000000000102','64000000-0000-4000-8000-000000000001')::text AS payload \gset cross_
RESET ROLE;
SELECT pg_temp.assert_stop(:'control_payload'::jsonb#>>'{receipt,outcome}'='applied'
 AND :'control_payload'::jsonb#>>'{current_state,auto_swing_enabled}'='false','assigned control without owner can stop');
SELECT pg_temp.assert_stop(:'cross_payload'::jsonb->>'error'='actor_not_allowed','control does not cross clubs');
SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000020',
 '64000000-0000-4000-8000-000000000103','64000000-0000-4000-8000-000000000002')::text AS payload \gset owner_
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000030',
 '64000000-0000-4000-8000-000000000104','64000000-0000-4000-8000-000000000002')::text AS payload \gset missing_
RESET ROLE;
SELECT pg_temp.assert_stop(:'owner_payload'::jsonb#>>'{receipt,outcome}'='applied','owner retains scoped stop');
SELECT pg_temp.assert_stop(:'missing_payload'::jsonb->>'error'='settings_missing','no implicit settings creation');
UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='64000000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000010',
 '64000000-0000-4000-8000-000000000105','64000000-0000-4000-8000-000000000003')::text AS payload \gset admin_
RESET ROLE;
SELECT pg_temp.assert_stop(:'admin_payload'::jsonb#>>'{receipt,outcome}'='applied','trusted super-admin role works');
UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id='64000000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000010',
 '64000000-0000-4000-8000-000000000101','64000000-0000-4000-8000-000000000001')::text AS payload \gset replay_
RESET ROLE;
SELECT pg_temp.assert_stop(:'replay_payload'::jsonb->'receipt'=:'control_payload'::jsonb->'receipt'
 AND :'replay_payload'::jsonb#>>'{current_state,auto_swing_enabled}'='true','replay observes newer ON, immutable receipt unchanged');
SELECT set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"user_metadata":{"role":"super_admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT public.operator_stop_dealer_swing_v1('64000000-0000-4000-8000-000000000010',
 '64000000-0000-4000-8000-000000000106','64000000-0000-4000-8000-000000000004')::text AS payload \gset forged_
RESET ROLE;
SELECT pg_temp.assert_stop(:'forged_payload'::jsonb->>'error'='actor_not_allowed','user metadata does not grant permission');
SELECT pg_temp.assert_stop(NOT EXISTS(SELECT 1 FROM public.club_settings WHERE club_id='64000000-0000-4000-8000-000000000030'),
 'missing settings remain missing');
SELECT pg_temp.assert_stop(NOT EXISTS(SELECT 1 FROM stop_settings_before b JOIN public.club_settings s USING(club_id)
 WHERE b.payload IS DISTINCT FROM to_jsonb(s)-'auto_swing_enabled'),'all unrelated settings unchanged');
SELECT pg_temp.assert_stop((SELECT count(*)=3 FROM public.table_operation_receipts WHERE operation_type='operator_stop_swing_v1'),
 'three authorized receipts only');
ROLLBACK;
SELECT 'SCOPED_STOP_EXACT_CURRENT_SCHEMA_ROLES_RECEIPTS_PASS' AS result;
