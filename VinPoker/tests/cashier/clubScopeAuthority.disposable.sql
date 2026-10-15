\set ON_ERROR_STOP on
-- Empty disposable PostgreSQL17 only. No live records, credentials or JWTs.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('fixture.actor',true),'')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('fixture.role',true),'')
$$;
CREATE TYPE public.app_role AS ENUM ('super_admin','cashier');
CREATE TABLE public.user_roles (user_id uuid,role public.app_role);
CREATE TABLE public.clubs (id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.club_cashiers (user_id uuid,club_id uuid);
CREATE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN _user_id='66666666-6666-6666-6666-666666666666'::uuid THEN NULL
    ELSE EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) END
$$;
INSERT INTO public.clubs VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222');
INSERT INTO public.club_cashiers VALUES
  ('33333333-3333-3333-3333-333333333333','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.user_roles VALUES
  ('44444444-4444-4444-4444-444444444444','super_admin');
-- Exact source baseline corresponding to the live MD5 precondition.
\ir ../../supabase/migrations/20260512214452_e9eae15b-1c3a-4d35-84b6-c0f5ad8348fe.sql
GRANT EXECUTE ON FUNCTION public.cashier_club_ids(uuid) TO anon,authenticated,service_role;
SET LOCAL ROLE anon;
SELECT set_config('fixture.role','anon',true),set_config('fixture.actor','',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.cashier_club_ids('44444444-4444-4444-4444-444444444444')) <> 2 THEN
    RAISE EXCEPTION 'Expected anonymous arbitrary-subject scope reproduction';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('fixture.role','authenticated',true),
  set_config('fixture.actor','33333333-3333-3333-3333-333333333333',true);
DO $$ BEGIN
  IF (SELECT array_agg(x) FROM public.cashier_club_ids('22222222-2222-2222-2222-222222222222') x)
      IS DISTINCT FROM ARRAY['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid] THEN
    RAISE EXCEPTION 'Expected authenticated cross-subject reproduction';
  END IF;
END $$;
RESET ROLE;
\echo CASHIER_SCOPE_ANON_AND_CROSS_SUBJECT_BASELINE_REPRODUCED
\ir ../../supabase/migrations/20270128000085_cashier_club_scope_authority_v1.sql
-- Model existing SECURITY DEFINER health/worklist callers: owner execution must
-- not turn the human request into unrestricted cross-user scope.
CREATE FUNCTION public.fixture_scoped_worklist() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT * FROM public.cashier_club_ids(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.fixture_scoped_worklist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fixture_scoped_worklist() TO authenticated;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.cashier_club_ids('44444444-4444-4444-4444-444444444444');
    RAISE EXCEPTION 'Anonymous helper execution unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT array_agg(x) FROM public.cashier_club_ids('33333333-3333-3333-3333-333333333333') x)
      IS DISTINCT FROM ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid] THEN
    RAISE EXCEPTION 'Own assigned cashier scope changed';
  END IF;
  IF (SELECT array_agg(x) FROM public.fixture_scoped_worklist() x)
      IS DISTINCT FROM ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid] THEN
    RAISE EXCEPTION 'Nested definer changed human caller scope';
  END IF;
  BEGIN
    PERFORM public.cashier_club_ids('22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'Cross-subject scope unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('fixture.actor','22222222-2222-2222-2222-222222222222',true);
  IF (SELECT array_agg(x) FROM public.cashier_club_ids(auth.uid()) x)
      IS DISTINCT FROM ARRAY['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid] THEN
    RAISE EXCEPTION 'Owner self-scope changed';
  END IF;
  PERFORM set_config('fixture.actor','55555555-5555-5555-5555-555555555555',true);
  IF EXISTS(SELECT 1 FROM public.cashier_club_ids(auth.uid())) THEN
    RAISE EXCEPTION 'Unassigned actor gained club access';
  END IF;
  PERFORM set_config('fixture.actor','44444444-4444-4444-4444-444444444444',true);
  IF (SELECT count(*) FROM public.cashier_club_ids(auth.uid())) <> 2 THEN
    RAISE EXCEPTION 'Super-admin self-scope changed';
  END IF;
  IF (SELECT count(*) FROM public.cashier_club_ids('22222222-2222-2222-2222-222222222222')) <> 1 THEN
    RAISE EXCEPTION 'Super-admin subject lookup failed';
  END IF;
  PERFORM set_config('fixture.actor','66666666-6666-6666-6666-666666666666',true);
  BEGIN
    PERFORM public.cashier_club_ids('22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'Unknown admin authority unexpectedly allowed cross-subject lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('fixture.actor','',true);
  BEGIN
    PERFORM public.cashier_club_ids('22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'Missing authenticated actor unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('fixture.role','service_role',true);
DO $$ BEGIN
  IF (SELECT array_agg(x) FROM public.cashier_club_ids('11111111-1111-1111-1111-111111111111') x)
      IS DISTINCT FROM ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid] THEN
    RAISE EXCEPTION 'Trusted Edge subject lookup changed';
  END IF;
  BEGIN
    PERFORM public.cashier_club_ids(NULL);
    RAISE EXCEPTION 'Null subject unexpectedly allowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
\echo CASHIER_SCOPE_ACTOR_TENANT_SERVICE_AND_EMPTY_PASS
ROLLBACK;
