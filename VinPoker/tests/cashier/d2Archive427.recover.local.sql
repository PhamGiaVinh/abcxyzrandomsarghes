-- Caller owns transaction. Recovery definition must match the retained patched body.
DO $$ DECLARE saved floor_private.d2_roster_backup242; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 SELECT * INTO STRICT saved FROM floor_private.d2_roster_backup242 WHERE id;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure)=saved.after_body_md5;
 EXECUTE saved.before_definition;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure)='ef51ea7658d54f31cea9679260992afa';
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.multi_day_final_roster_v1(uuid)'::regprocedure) IS NOT DISTINCT FROM saved.before_acl;
END $$;
