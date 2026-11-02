-- Restore only the reviewed read RPC definition/ACL/owner, never invoice data.
DO $$ DECLARE saved floor_private.fnb_guest_status_release_backup231;BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure)<>'2dec3d76331a32a7d5a912e2b2c710b5'
 OR (SELECT count(*) FROM floor_private.fnb_guest_status_release_backup231)<>1 THEN RAISE EXCEPTION 'exact_local353_recovery_required';END IF;
 SELECT * INTO STRICT saved FROM floor_private.fnb_guest_status_release_backup231;
 IF (SELECT proacl FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure) IS DISTINCT FROM saved.acl
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure)<>saved.owner_name
 THEN RAISE EXCEPTION 'status353_acl_owner_drift';END IF;
 EXECUTE saved.definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_order_status(text,uuid)'::regprocedure)<>'40bcb1f1fff465964785b74779f04d58'
 THEN RAISE EXCEPTION 'status353_restore_failed';END IF;
END $$;
