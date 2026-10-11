BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $postcheck$
DECLARE p record;
BEGIN
 SELECT md5(replace(prosrc,chr(13),'')) body_hash,prosecdef,proowner,proconfig,proacl::text acl
 INTO p FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure;
 IF p.body_hash IS DISTINCT FROM 'af819405bab3861283d6dc18b51907fa'
 OR p.prosecdef IS DISTINCT FROM true OR p.proowner IS DISTINCT FROM 'postgres'::regrole
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
 OR p.acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'completed_void59_object_drift';
 END IF;
 IF has_function_privilege('anon','public.void_last_hand(uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.void_last_hand(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.void_last_hand(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'completed_void59_effective_grants_drift';
 END IF;
END $postcheck$;
COMMIT;
\echo COMPLETED_VOID59_OBJECT_POSTCHECK_PASS
