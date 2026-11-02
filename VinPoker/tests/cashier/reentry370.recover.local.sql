\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ DECLARE backup record; BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local370_recovery_only';END IF;
 SELECT * INTO STRICT backup FROM floor_private.cashier_reentry_release_backup233 WHERE id;
 IF backup.old_md5 IS DISTINCT FROM '0c1ec452d3450a6f7cb6b8b6fe32e877'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure) IS DISTINCT FROM '8c1fed4cdecbccde55c7f8ba5aa7b169'
 OR EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure
  AND (proacl IS DISTINCT FROM backup.saved_acl OR pg_get_userbyid(proowner) IS DISTINCT FROM backup.owner_name)) THEN RAISE EXCEPTION 'local370_recovery_drift';END IF;
 EXECUTE backup.saved_definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure) IS DISTINCT FROM backup.old_md5 THEN RAISE EXCEPTION 'local370_recovery_unconfirmed';END IF;
END $$;
-- Keep the private release backup and all registrations/audits intact.
COMMIT;
