-- Forward repair only: table SELECT currently overrides the historical
-- public-column allowlist. Preserve the public Marketplace verification badge;
-- do not expose phone/bank/internal notification or verification-owner fields.
-- Authenticated grants, RLS, rows and all write privileges remain unchanged.
DO $migration$
DECLARE
  public_columns constant text[] := ARRAY[
    'id','user_id','display_name','region','avatar_url','bio','is_verified',
    'rating_avg','total_deals','display_name_lower','created_at','updated_at',
    'verification_status'
  ];
  original_authenticated_access boolean;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('statement_timeout','30s',true);
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.profiles'::regclass
      AND relkind='r' AND relrowsecurity) THEN
    RAISE EXCEPTION 'profiles public projection: RLS/table precondition mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon'
      AND (rolsuper OR rolbypassrls)) OR EXISTS (
      SELECT 1 FROM pg_auth_members WHERE member='anon'::regrole) THEN
    RAISE EXCEPTION 'profiles public projection: unexpected anonymous role authority';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.profiles'::regclass
      AND attnum>0 AND NOT attisdropped AND attname=ANY(public_columns))
      <> cardinality(public_columns) THEN
    RAISE EXCEPTION 'profiles public projection: missing expected public column';
  END IF;
  original_authenticated_access := has_table_privilege(
    'authenticated','public.profiles','SELECT');
  IF NOT original_authenticated_access THEN
    RAISE EXCEPTION 'profiles public projection: authenticated baseline changed';
  END IF;

  -- REVOKE table SELECT also removes anon's column grants. Re-grant explicitly.
  REVOKE SELECT ON public.profiles FROM anon;
  GRANT SELECT (id,user_id,display_name,region,avatar_url,bio,is_verified,
    rating_avg,total_deals,display_name_lower,created_at,updated_at,
    verification_status) ON public.profiles TO anon;

  IF has_table_privilege('anon','public.profiles','SELECT') OR EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid='public.profiles'::regclass
      AND attnum>0 AND NOT attisdropped AND
      has_column_privilege('anon','public.profiles',attname,'SELECT')
        IS DISTINCT FROM (attname=ANY(public_columns))) THEN
    RAISE EXCEPTION 'profiles public projection: effective privileges mismatch';
  END IF;
  IF has_table_privilege('authenticated','public.profiles','SELECT')
      IS DISTINCT FROM original_authenticated_access THEN
    RAISE EXCEPTION 'profiles public projection: authenticated access changed';
  END IF;
END;
$migration$;
