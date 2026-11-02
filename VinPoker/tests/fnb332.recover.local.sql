-- Definition recovery only; never delete request receipts or orders.
DO $$
DECLARE saved floor_private.fnb_guest_release_backup228;
BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'local332_recovery_only';END IF;
 IF (SELECT count(*) FROM floor_private.fnb_guest_release_backup228)<>1 THEN RAISE EXCEPTION 'backup332_ambiguous';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.fnb_guest_create_order_core228(text,smallint,text,text,jsonb,text,text)'::regprocedure)<>'3b18941a8cee95dc16bedc8c8c603a77' THEN RAISE EXCEPTION 'core332_drift';END IF;
 SELECT * INTO saved FROM floor_private.fnb_guest_release_backup228;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)'::regprocedure
   AND (proacl IS DISTINCT FROM saved.acl OR pg_get_userbyid(proowner)<>saved.owner_name)) THEN RAISE EXCEPTION 'public332_acl_owner_drift';END IF;
 EXECUTE saved.definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)'::regprocedure)<>'3b18941a8cee95dc16bedc8c8c603a77' THEN RAISE EXCEPTION 'restore332_failed';END IF;
END $$;
