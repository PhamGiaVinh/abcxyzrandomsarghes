\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() NOT LIKE 'vinpoker_ops_cashier_runtime_%'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 55464 THEN
    RAISE EXCEPTION 'isolated Cashier ACL fixture required';
  END IF;
END;
$guard$;

GRANT USAGE, CREATE ON SCHEMA public TO supabase_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
SET ROLE supabase_admin;
CREATE FUNCTION public.cashier_test_restore_acl_probe() RETURNS boolean LANGUAGE sql AS 'SELECT true';
RESET ROLE;
ALTER FUNCTION public.cashier_test_restore_acl_probe() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cashier_test_restore_acl_probe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cashier_test_restore_acl_probe() TO service_role;
DO $repro$
BEGIN
  IF NOT has_function_privilege('anon', 'public.cashier_test_restore_acl_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'named creation grant contamination was not reproduced';
  END IF;
END;
$repro$;
DROP FUNCTION public.cashier_test_restore_acl_probe();

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;
SET ROLE supabase_admin;
CREATE FUNCTION public.cashier_test_restore_acl_probe() RETURNS boolean LANGUAGE sql AS 'SELECT true';
RESET ROLE;
ALTER FUNCTION public.cashier_test_restore_acl_probe() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cashier_test_restore_acl_probe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cashier_test_restore_acl_probe() TO service_role;
DO $postcheck$
BEGIN
  IF has_function_privilege('anon', 'public.cashier_test_restore_acl_probe()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cashier_test_restore_acl_probe()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cashier_test_restore_acl_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'captured restrictive ACL did not survive conditioned restore';
  END IF;
END;
$postcheck$;
ROLLBACK;
\echo CASHIER_RESTORE_CREATOR_DEFAULT_ACL_CONTAMINATION_AND_FIX_PASS
