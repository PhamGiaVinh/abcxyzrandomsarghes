-- Recovery removes the new write endpoint only. Never delete terminal fences,
-- restore NOT NULL over them, or change the existing create/read RPCs.
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)')) IS DISTINCT FROM '1c1ade1d97afba249f1bdcc88c252147'
 THEN RAISE EXCEPTION 'exact_local347_recovery_required';END IF;
END $$;
DROP FUNCTION public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text);
