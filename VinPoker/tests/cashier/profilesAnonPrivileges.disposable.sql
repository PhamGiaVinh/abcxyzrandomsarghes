\set ON_ERROR_STOP on
-- Run ONLY in an empty, disposable PostgreSQL 17 database as its owner.
-- All fixture data and roles roll back. Never run against a live project.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, user_id uuid, display_name text, region text,
  avatar_url text, bio text, is_verified boolean, rating_avg numeric,
  total_deals integer, display_name_lower text, created_at timestamptz,
  updated_at timestamptz, phone text, bank_name text,
  bank_account_number text, bank_account_holder text,
  welcome_email_sent_at timestamptz, verification_status text,
  verified_by_club_id uuid, verified_at timestamptz,
  onesignal_external_user_id text
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles selectable by all" ON public.profiles
  FOR SELECT TO PUBLIC USING (true);
GRANT ALL ON public.profiles TO anon, authenticated;
GRANT SELECT (id,user_id,display_name,region,avatar_url,bio,is_verified,
  rating_avg,total_deals,display_name_lower,created_at,updated_at)
  ON public.profiles TO anon, authenticated;
GRANT SELECT (phone,bank_name,bank_account_number,bank_account_holder,
  welcome_email_sent_at) ON public.profiles TO authenticated;
CREATE VIEW public.profiles_public WITH (security_invoker=true) AS
  SELECT id,user_id,display_name,region,avatar_url,created_at,updated_at
  FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;
INSERT INTO public.profiles (id,user_id,display_name,phone,bank_account_number)
VALUES ('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002','FIXTURE ONLY','FIXTURE PHONE','FIXTURE BANK');

SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles
      WHERE phone IS NOT NULL AND bank_account_number IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'Expected reproduction of broad table SELECT overriding column limits';
  END IF;
END $$;
RESET ROLE;
\echo PROFILES_ANON_BASELINE_PRIVATE_COLUMN_READ_REPRODUCED

-- Candidate containment, not a production migration. PostgreSQL table-level
-- REVOKE also removes the grantee's column grants: explicitly restore the
-- intended public projection afterward. Authenticated behavior is unchanged.
REVOKE SELECT ON public.profiles FROM anon;
DO $$ BEGIN
  IF has_column_privilege('anon','public.profiles','display_name','SELECT') THEN
    RAISE EXCEPTION 'Expected table REVOKE to remove the old column grants too';
  END IF;
END $$;
GRANT SELECT (id,user_id,display_name,region,avatar_url,bio,is_verified,
  rating_avg,total_deals,display_name_lower,created_at,updated_at)
  ON public.profiles TO anon;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(display_name) FROM public.profiles) <> 1 OR
     (SELECT count(*) FROM public.profiles_public) <> 1 THEN
    RAISE EXCEPTION 'Public identity/listing view must remain readable';
  END IF;
  BEGIN
    PERFORM phone FROM public.profiles;
    RAISE EXCEPTION 'Anonymous phone read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM bank_account_number FROM public.profiles;
    RAISE EXCEPTION 'Anonymous bank read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.profiles;
    RAISE EXCEPTION 'Anonymous wildcard read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Existing anonymous Marketplace projection fails after containment;
  -- do not ship the ACL change without resolving its public badge contract.
  BEGIN
    PERFORM user_id,display_name,avatar_url,verification_status FROM public.profiles;
    RAISE EXCEPTION 'Expected Marketplace compatibility failure was absent';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Existing PlayerProfile projection also asks for phone before login.
  BEGIN
    PERFORM user_id,display_name,region,phone,avatar_url FROM public.profiles;
    RAISE EXCEPTION 'Expected PlayerProfile compatibility failure was absent';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles
      WHERE phone IS NOT NULL AND bank_account_number IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'Existing authenticated access must remain unchanged';
  END IF;
END $$;
RESET ROLE;
\echo PROFILES_ANON_CONTAINMENT_AND_PUBLIC_CLIENT_COMPATIBILITY_GAPS_CONFIRMED
-- Test the actual forward migration, not just the candidate SQL above.
-- Restore the vulnerable live ACL first: otherwise a missing REVOKE in the
-- migration could pass because the hand-written candidate already restricted it.
GRANT SELECT ON public.profiles TO anon;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles
      WHERE phone IS NOT NULL AND bank_account_number IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'Actual migration must start from the vulnerable live baseline';
  END IF;
END $$;
RESET ROLE;
-- Include twice to prove a safe retry does not widen the projection.
\ir ../../supabase/migrations/20270128000084_profiles_anon_public_projection_v1.sql
\ir ../../supabase/migrations/20270128000084_profiles_anon_public_projection_v1.sql
SET LOCAL ROLE anon;
DO $$ DECLARE private_column text; BEGIN
  PERFORM user_id,display_name,avatar_url,verification_status FROM public.profiles;
  PERFORM user_id,display_name,region,avatar_url FROM public.profiles;
  FOREACH private_column IN ARRAY ARRAY['phone','bank_name','bank_account_number',
    'bank_account_holder','welcome_email_sent_at','verified_by_club_id',
    'verified_at','onesignal_external_user_id'] LOOP
    BEGIN
      EXECUTE format('SELECT %I FROM public.profiles',private_column);
      RAISE EXCEPTION 'Forward migration exposed column %',private_column;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM * FROM public.profiles;
    RAISE EXCEPTION 'Forward migration exposed wildcard projection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Newly added columns must not silently become anonymous-readable.
ALTER TABLE public.profiles ADD COLUMN future_private_field text;
DO $$ BEGIN
  IF has_column_privilege('anon','public.profiles','future_private_field','SELECT') THEN
    RAISE EXCEPTION 'New column inherited anonymous SELECT';
  END IF;
END $$;
\echo PROFILES_ANON_ACTUAL_MIGRATION_RETRY_AND_PUBLIC_PROJECTIONS_PASS
ROLLBACK;
