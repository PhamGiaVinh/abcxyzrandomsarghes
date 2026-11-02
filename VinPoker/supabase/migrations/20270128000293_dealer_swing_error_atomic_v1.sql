-- CLI generated20261025092030; reserved293 after source/catalog collision check.
-- LOCAL candidate only. Preserve the terminal error receipt while rolling back
-- outer transition/break writes when the inner assignment transaction fails.
-- Recovery: restore the exact captured292 definition only after digest check;
-- never remove receipts or rewrite attendance/payroll/audit to recover.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE sig regprocedure:='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
 definition text;old_owner oid;old_acl aclitem[];old_config text[];
 start_anchor text:=$start$  UPDATE dealer_attendance SET current_state = 'in_transition'$start$;
 end_anchor text:=$end$  RETURN v_swing_result;
END;$end$;
BEGIN
 IF current_user<>'postgres' OR md5(pg_get_functiondef(sig))<>'54dfcbdc56d3c412d1170d8996ca22c9'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000293') THEN
  RAISE EXCEPTION 'dealer_swing293_dependency_drift';END IF;
 SELECT pg_get_functiondef(oid),proowner,proacl,proconfig INTO definition,old_owner,old_acl,old_config FROM pg_proc WHERE oid=sig;
 IF array_length(string_to_array(definition,start_anchor),1)<>2 OR array_length(string_to_array(definition,end_anchor),1)<>2 THEN
  RAISE EXCEPTION 'dealer_swing293_patch_anchor_not_unique';END IF;
 definition:=replace(definition,start_anchor,$block$  -- Include outer state changes in the inner error rollback boundary.
  BEGIN
$block$||start_anchor);
 definition:=replace(definition,end_anchor,$block$  IF v_swing_result->>'outcome'='error' THEN
    RAISE EXCEPTION USING ERRCODE='VP293',MESSAGE='dealer_swing_inner_error';
  END IF;
  RETURN v_swing_result;
  EXCEPTION WHEN SQLSTATE 'VP293' THEN
    -- Local variables retain the inner result; SQL writes in this block roll back.
    RETURN v_swing_result;
  END;
END;$block$);
 EXECUTE definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=sig AND proowner=old_owner AND proacl IS NOT DISTINCT FROM old_acl AND proconfig IS NOT DISTINCT FROM old_config) THEN
  RAISE EXCEPTION 'dealer_swing293_catalog_metadata_changed';END IF;
END $patch$;
COMMIT;
