-- Transaction-local prototype only. Caller must establish the owned clone guard.
DO $patch$ DECLARE definition text;owner_before oid;acl_before aclitem[];config_before text[];
anchor text:=$needle$      EXCEPTION WHEN OTHERS THEN
        v_outcome := 'flagged_not_pending';
        v_reason := left(coalesce(SQLERRM, 'fnb_settle_exception'), 200);
      END;$needle$;
BEGIN
 SELECT pg_get_functiondef(oid),proowner,proacl,proconfig INTO definition,owner_before,acl_before,config_before
 FROM pg_proc WHERE oid='public.settle_bank_transaction(uuid,boolean)'::regprocedure;
 ASSERT md5(definition)='1fd77b3e02d0317c4a838aeef28646cf';
 ASSERT (length(definition)-length(replace(definition,anchor,'')))/length(anchor)=1;
 EXECUTE replace(definition,anchor,$replacement$      EXCEPTION WHEN OTHERS THEN
        -- Technical failures are not business-terminal receipts. Preserve SQLSTATE so
        -- the caller reports failure; retry revalidates the same locked bank event.
        RAISE;
      END;$replacement$);
 ASSERT (SELECT proowner=owner_before AND proacl IS NOT DISTINCT FROM acl_before AND proconfig IS NOT DISTINCT FROM config_before FROM pg_proc WHERE oid='public.settle_bank_transaction(uuid,boolean)'::regprocedure);
END $patch$;
