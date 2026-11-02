-- Additive after 287: browsers may create only via the keyed writer.
-- The original helper stays callable by its postgres owner inside v2.
-- Recovery of this ACL-only change is the exact captured pre-apply proacl;
-- do not replay historical function bodies or grant PUBLIC for rollback.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'online288_requires_postgres'; END IF;
  IF md5(pg_get_functiondef('public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure)) <> '1e522dbfcbaa77628b231351fb1fb4e4' THEN
    RAISE EXCEPTION 'online288_legacy_definition_drift';
  END IF;
  IF md5(pg_get_functiondef('public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)'::regprocedure)) <> '44a816ef45c75b8d49307989932a6da2' OR
     md5(pg_get_functiondef('public.op_get_create_receipt_v1(uuid)'::regprocedure)) <> '40563ba9f6ab9d5142adba20efa8aa76' THEN
    RAISE EXCEPTION 'online288_keyed_dependency_drift';
  END IF;
  IF (SELECT proowner <> 'postgres'::regrole FROM pg_proc WHERE oid='public.op_create_open_table(text,bigint,bigint,bigint,integer)'::regprocedure) OR
     (SELECT proowner <> 'postgres'::regrole FROM pg_proc WHERE oid='public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'online288_owner_drift';
  END IF;
END
$guard$;
REVOKE ALL ON FUNCTION public.op_create_open_table(text,bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $post$
BEGIN
  IF has_function_privilege('anon','public.op_create_open_table(text,bigint,bigint,bigint,integer)','EXECUTE') OR
     has_function_privilege('authenticated','public.op_create_open_table(text,bigint,bigint,bigint,integer)','EXECUTE') OR
     has_function_privilege('service_role','public.op_create_open_table(text,bigint,bigint,bigint,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'online288_direct_execute_remains';
  END IF;
  IF NOT has_function_privilege('authenticated','public.op_create_open_table_v2(text,bigint,bigint,bigint,integer,uuid)','EXECUTE') OR
     NOT has_function_privilege('authenticated','public.op_get_create_receipt_v1(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'online288_keyed_access_missing';
  END IF;
END
$post$;
COMMIT;
