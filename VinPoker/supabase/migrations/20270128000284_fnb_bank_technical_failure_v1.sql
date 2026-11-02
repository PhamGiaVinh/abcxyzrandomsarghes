-- CLI generated20261024201101; reserved forward284 after283/catalog check.
-- FNB technical exceptions must reach the caller, not become terminal business audit.
-- Does NOT retry/rewrite historical terminal settlements or change business matching.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $patch$ DECLARE definition text;owner_before oid;acl_before aclitem[];config_before text[];
anchor text:=$needle$      EXCEPTION WHEN OTHERS THEN
        v_outcome := 'flagged_not_pending';
        v_reason := left(coalesce(SQLERRM, 'fnb_settle_exception'), 200);
      END;$needle$;
BEGIN
 IF current_user<>'postgres' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000284')
  OR md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))<>'e882cbe4a609fb435b5f75d1e7ab0982'
 THEN RAISE EXCEPTION 'FNB284_CATALOG_OR_CORE_DRIFT';END IF;
 SELECT pg_get_functiondef(oid),proowner,proacl,proconfig INTO STRICT definition,owner_before,acl_before,config_before
 FROM pg_proc WHERE oid='public.settle_bank_transaction(uuid,boolean)'::regprocedure AND prosecdef;
 IF md5(definition)<>'1fd77b3e02d0317c4a838aeef28646cf'
  OR (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
 THEN RAISE EXCEPTION 'FNB284_PARENT_OR_SEAM_DRIFT';END IF;
 EXECUTE replace(definition,anchor,$replacement$      EXCEPTION WHEN OTHERS THEN
        -- Technical failures are not business-terminal receipts. Preserve SQLSTATE so
        -- the caller reports failure; retry revalidates the same locked bank event.
        RAISE;
      END;$replacement$);
 IF md5(pg_get_functiondef('public.settle_bank_transaction(uuid,boolean)'::regprocedure))<>'a168fe83773001f1f448e25ff2aab3ab'
  OR NOT(SELECT proowner=owner_before AND proacl IS NOT DISTINCT FROM acl_before AND proconfig IS NOT DISTINCT FROM config_before AND prosecdef
  FROM pg_proc WHERE oid='public.settle_bank_transaction(uuid,boolean)'::regprocedure)
  OR NOT has_function_privilege('service_role','public.settle_bank_transaction(uuid,boolean)','EXECUTE')
  OR has_function_privilege('authenticated','public.settle_bank_transaction(uuid,boolean)','EXECUTE')
  OR has_function_privilege('anon','public.settle_bank_transaction(uuid,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'FNB284_AUTHORITY_CHANGED';END IF;
END $patch$;
COMMIT;
