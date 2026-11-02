\set ON_ERROR_STOP on
-- PRE-USE recovery test only. Caller owns transaction and ROLLBACKs it.
-- Once a durable v2 receipt exists, keep backend compatibility and rollback UI.
DO $recover$
DECLARE definition text;
BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 IF EXISTS(SELECT 1 FROM floor_private.chip_mutation_receipts WHERE operation='bank_adjust_v2') THEN
  RAISE EXCEPTION 'BANK271_RECOVERY_REFUSES_EXISTING_RECEIPTS';END IF;
 definition:=pg_get_functiondef('floor_private.chip_bank_adjust_primitive_v1(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure);
 EXECUTE replace(definition,'CREATE OR REPLACE FUNCTION floor_private.chip_bank_adjust_primitive_v1(',
   'CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(');
END $recover$;
DROP FUNCTION public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid),public.get_chip_bank_adjust_receipt_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid);
DROP FUNCTION floor_private.resolve_chip_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid,text);
DROP FUNCTION floor_private.chip_bank_adjust_primitive_v1(uuid,uuid,text,bigint,uuid,integer,text);
DO $post$ BEGIN
 ASSERT md5(pg_get_functiondef('public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)'::regprocedure))='da643ca448cb56633268c8b377895b19';
 ASSERT has_function_privilege('authenticated','public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)','EXECUTE');
END $post$;
SELECT 'BANK271_PREUSE_RECOVERY_EXACT_ORIGINAL_BODY_PASS';
