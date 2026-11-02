-- CLI candidate20261018170839 ->161. LOCAL qualified before release.
-- Old function remains owner-only implementation; no direct service CAS bypass.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000161')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.commit_staking_release_v2(uuid,jsonb)')
   AND prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig @> ARRAY['search_path=""']
   AND prosrc LIKE '%staking_release_preview_stale%' AND prosrc LIKE '%public.commit_staking_release_v1%')
 THEN RAISE EXCEPTION 'staking161_v2_precondition_failed';END IF;
END $$;
REVOKE ALL ON FUNCTION public.commit_staking_release_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
