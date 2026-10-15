\set ON_ERROR_STOP on
-- Actual recovered public schema, not replacement auth/RLS helpers. TEST ONLY.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'vinpoker_ops_authority84_85_%'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_user<>'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'owned_authority84_85_required'; END IF;
END $$;
-- Managed auth grants are omitted by the public-schema-only capture.
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE FUNCTION pg_temp.check_authority(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'authority84_85_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES
 ('f2840000-0000-4000-8000-000000000001'),('f2840000-0000-4000-8000-000000000002'),
 ('f2840000-0000-4000-8000-000000000003'),('f2840000-0000-4000-8000-000000000004');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f2840000-0000-4000-8000-000000000011','f2840000-0000-4000-8000-000000000001','Authority A TEST','TEST'),
 ('f2840000-0000-4000-8000-000000000012','f2840000-0000-4000-8000-000000000002','Authority B TEST','TEST');
INSERT INTO public.club_cashiers(club_id,user_id) VALUES
 ('f2840000-0000-4000-8000-000000000011','f2840000-0000-4000-8000-000000000003');
INSERT INTO public.profiles(id,user_id,display_name,phone,bank_account_number) VALUES
 ('f2840000-0000-4000-8000-000000000021','f2840000-0000-4000-8000-000000000001','Public authority TEST','TEST-NOT-A-PHONE','TEST-NOT-A-BANK');
SET LOCAL ROLE anon;
DO $$ DECLARE column_name text; BEGIN
 IF NOT EXISTS(SELECT FROM public.profiles WHERE user_id='f2840000-0000-4000-8000-000000000001'
   AND display_name='Public authority TEST') THEN RAISE EXCEPTION 'public_profile_positive_missing'; END IF;
 FOREACH column_name IN ARRAY ARRAY['phone','bank_name','bank_account_number','bank_account_holder',
 'welcome_email_sent_at','verified_by_club_id','verified_at','onesignal_external_user_id'] LOOP
  BEGIN
   EXECUTE format('SELECT %I FROM public.profiles',column_name);
   RAISE EXCEPTION 'private_profile_column_exposed: %',column_name;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 BEGIN PERFORM * FROM public.profiles; RAISE EXCEPTION 'wildcard_profile_exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.cashier_club_ids('f2840000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'anonymous_subject_scope_exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f2840000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_authority(
 (SELECT array_agg(x) FROM public.cashier_club_ids(auth.uid()) x)
 =ARRAY['f2840000-0000-4000-8000-000000000011'::uuid],'cashier self scope');
DO $$ BEGIN
 BEGIN PERFORM public.cashier_club_ids('f2840000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'cross_subject_scope_exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f2840000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_authority(
 (SELECT array_agg(x) FROM public.cashier_club_ids(auth.uid()) x)
 =ARRAY['f2840000-0000-4000-8000-000000000011'::uuid],'owner self scope');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f2840000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_authority(NOT EXISTS(SELECT FROM public.cashier_club_ids(auth.uid())),'unassigned self empty');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.check_authority(
 (SELECT array_agg(x) FROM public.cashier_club_ids('f2840000-0000-4000-8000-000000000002') x)
 =ARRAY['f2840000-0000-4000-8000-000000000012'::uuid],'trusted service subject scope');
RESET ROLE;
\echo ACTUAL_SCHEMA_PROFILE84_COLUMN_AND_CASHIER85_ROLE_SCOPE_PASS
ROLLBACK;
