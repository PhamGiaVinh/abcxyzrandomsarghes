\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT md5(replace(pg_get_functiondef('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)'::regprocedure),chr(13),''))='22bf8a1b1ee90c116d6ad2908e85cf09';
END $$;
-- No CASCADE; only the exact new function. Keep all receipts and tombstones.
DROP FUNCTION public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text);
COMMIT;
