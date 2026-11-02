-- Caller owns transaction; recovery is local-only and checks current body first.
DO $$ DECLARE saved floor_private.clock_control_backup243; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 SELECT * INTO STRICT saved FROM floor_private.clock_control_backup243 WHERE id;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure)=saved.after_body_md5;
 EXECUTE saved.before_definition;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure)='b2cc545b44f169740cd9476e9fb78259';
 ASSERT (SELECT proacl FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure) IS NOT DISTINCT FROM saved.before_acl;
END $$;
