-- Purpose-clone prototype only; no primary-database or production installer.
DO $$ DECLARE body text;anchor text:='v_old       text;';BEGIN
 ASSERT current_database()='vinpoker_fnb719_gate_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT current_setting('test.fnb720_enum',true)='on';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())=
  'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
 ASSERT md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))='458176bb3c8b293d0c44056b15309670';
 body:=pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure);
 ASSERT (length(body)-length(replace(body,anchor,'')))/length(anchor)=1;
 EXECUTE replace(body,anchor,'v_old       public.fnb_order_status;');
END $$;
