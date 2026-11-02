DO $$ DECLARE body text;anchor text;before_proc record;after_proc record;BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT current_setting('test.fnb728_clone',true)='on';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT EXISTS(SELECT 1 FROM floor_private.fnb728_fixtures WHERE phase='baseline' AND fixture->>'stock'='8' AND fixture->'result'->>'status'='ok');
 SELECT * INTO STRICT before_proc FROM pg_proc WHERE oid='public.fnb_create_comp_order(uuid,public.fnb_order_source,text,text,text,jsonb,text,text)'::regprocedure;
 body:=pg_get_functiondef(before_proc.oid);ASSERT md5(body)='58def8a74196387e1ac9722ae94f4651';
 anchor:='PERFORM floor_private.fnb_cash_event_gate_v1(p_club_id);';
 ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1;
 body:=replace(body,anchor,anchor||chr(10)||'  IF NOT(public.is_club_fnb_kind(v_uid,p_club_id,''cashier'') OR public.is_club_owner(v_uid,p_club_id)) THEN RETURN jsonb_build_object(''error'',''Forbidden'',''detail'',''comp requires cashier or owner'');END IF;');
 EXECUTE body;
 SELECT * INTO STRICT after_proc FROM pg_proc WHERE oid=before_proc.oid;
 ASSERT before_proc.proowner=after_proc.proowner AND before_proc.proacl IS NOT DISTINCT FROM after_proc.proacl
  AND before_proc.proconfig IS NOT DISTINCT FROM after_proc.proconfig AND before_proc.prosecdef=after_proc.prosecdef;
END $$;
