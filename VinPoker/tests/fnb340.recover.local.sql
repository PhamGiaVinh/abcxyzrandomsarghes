-- New read endpoint only; retain every order, receipt and writer definition.
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441
 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)')) IS DISTINCT FROM '6ad2faf30241557404a88af898b1e8b7'
 THEN RAISE EXCEPTION 'exact_local340_reader_required';END IF;
END $$;
DROP FUNCTION public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text);
