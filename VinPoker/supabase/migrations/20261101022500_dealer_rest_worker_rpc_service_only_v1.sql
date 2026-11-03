-- PENDING LOCAL CANDIDATE, not an active forward-ledger migration.
-- These internal RPCs are called by server admin clients, not dealer browsers.
-- Rollback: restore exact saved ACLs via reviewed forward GRANT/REVOKE; retain
-- all business state and markers. No function body, row, or history rewrite.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $preflight$
BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.atomic_dealer_ready_check(uuid,uuid)'::regprocedure AND md5(prosrc)='b9dc78d89a1f89458c3edd476251e72a' AND md5(proacl::text)='791d2b1e22edbb03f97770724fbb588b' AND prosecdef AND proowner='postgres'::regrole) THEN RAISE EXCEPTION 'dealer_rest_worker_rpc_definition_or_acl_drift';END IF;
IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.end_expired_breaks(uuid)'::regprocedure AND md5(prosrc)='b67adb66d51bbe3abec9864d26e00d66' AND md5(proacl::text)='791d2b1e22edbb03f97770724fbb588b' AND prosecdef AND proowner='postgres'::regrole) THEN RAISE EXCEPTION 'dealer_rest_worker_rpc_definition_or_acl_drift';END IF;
IF to_regclass('floor_private.dealer_rest_worker_acl_backup_v1') IS NOT NULL THEN
 RAISE EXCEPTION 'dealer_rest_worker_acl_backup_collision';END IF;
END;
$preflight$;
CREATE TABLE floor_private.dealer_rest_worker_acl_backup_v1(
 signature text PRIMARY KEY,original_acl aclitem[] NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON floor_private.dealer_rest_worker_acl_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.dealer_rest_worker_acl_backup_v1(signature,original_acl)
 SELECT oid::regprocedure::text,proacl FROM pg_proc WHERE oid IN(
 'public.atomic_dealer_ready_check(uuid,uuid)'::regprocedure,
 'public.end_expired_breaks(uuid)'::regprocedure);
REVOKE EXECUTE ON FUNCTION public.atomic_dealer_ready_check(uuid,uuid),public.end_expired_breaks(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_dealer_ready_check(uuid,uuid),public.end_expired_breaks(uuid)
 TO service_role;
COMMIT;
