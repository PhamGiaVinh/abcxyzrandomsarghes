\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ DECLARE saved floor_private.fnb_shipping_release_backup235%ROWTYPE;BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'fnb383_recovery_local_only';END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure) IS DISTINCT FROM '31b85897c490845913ab864bdfd5320c' THEN RAISE EXCEPTION 'fnb383_recovery_current_drift';END IF;
 SELECT * INTO STRICT saved FROM floor_private.fnb_shipping_release_backup235 WHERE id;
 IF saved.old_md5<>'f38043fd146c6180e690a611140b9c30' OR EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure AND (proacl IS DISTINCT FROM saved.saved_acl OR pg_get_userbyid(proowner) IS DISTINCT FROM saved.owner_name OR proconfig IS DISTINCT FROM saved.saved_config)) THEN RAISE EXCEPTION 'fnb383_recovery_backup_or_acl_drift';END IF;
 EXECUTE saved.saved_definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure) IS DISTINCT FROM saved.old_md5 THEN RAISE EXCEPTION 'fnb383_recovery_failed';END IF;
END $$;
COMMIT;
