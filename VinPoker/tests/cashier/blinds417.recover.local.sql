-- Explicit transaction, exact LOCAL only. Restore saved function/ACL, no level writes.
DO $$ DECLARE definition text;acl aclitem[];BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure)='cd7c7f07cecb78328bb3637f60111add';
 SELECT before_definition,before_acl INTO STRICT definition,acl FROM floor_private.blind_structure_update_backup241
 WHERE id AND after_body_md5='cd7c7f07cecb78328bb3637f60111add';
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure) IS NOT DISTINCT FROM acl;
 EXECUTE definition;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure)='dfb99c7cab941b59edca5ade048242e9';
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.update_blind_structure(uuid,jsonb)'::regprocedure) IS NOT DISTINCT FROM acl;
END $$;
DROP TABLE floor_private.blind_structure_update_backup241;
