-- Candidate recovery: restore the previous Edge transport before dropping RPC.
-- Source registrations, cash movements and notifications are preserved.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.cashier_app_reentry_transport_v1(uuid,uuid)')
  AND md5(replace(prosrc,chr(13),''))='c4c92942cd29a910afaa266c0ea29ce6'
  AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='v'
  AND proconfig=ARRAY['search_path=""']::text[]
  AND has_function_privilege('service_role',oid,'EXECUTE')
  AND NOT has_function_privilege('anon',oid,'EXECUTE')
  AND NOT has_function_privilege('authenticated',oid,'EXECUTE')
  AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) a
   WHERE a.grantee NOT IN(proowner,(SELECT oid FROM pg_roles WHERE rolname='service_role'))
    OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'reentry_transport_recovery_postimage_drift';
 END IF;
END $$;
DROP FUNCTION public.cashier_app_reentry_transport_v1(uuid,uuid);
COMMIT;
