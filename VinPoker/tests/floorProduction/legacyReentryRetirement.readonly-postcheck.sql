-- LR01 live-safe catalog postcheck: no function invocation or data mutation.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $postcheck$
DECLARE p record;
BEGIN
 SELECT md5(replace(pg_get_functiondef(oid),chr(13),'')) definition_hash,
 proowner,prosecdef,proconfig,proacl::text acl INTO STRICT p FROM pg_proc
 WHERE oid='public.re_enter_tournament(uuid,uuid,integer)'::regprocedure;
 IF p.definition_hash IS DISTINCT FROM 'e0994c41b497a51e6f506d1208a4fc4d'
 OR p.proowner IS DISTINCT FROM 'postgres'::regrole OR p.prosecdef
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR p.acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 THEN RAISE EXCEPTION 'legacy_reentry60_object_drift'; END IF;
 IF has_function_privilege('anon','public.re_enter_tournament(uuid,uuid,integer)','EXECUTE')
 OR has_function_privilege('service_role','public.re_enter_tournament(uuid,uuid,integer)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.re_enter_tournament(uuid,uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'legacy_reentry60_effective_grants_drift'; END IF;
 SELECT md5(replace(pg_get_functiondef(oid),chr(13),'')) definition_hash,
 proowner,prosecdef,proconfig,proacl::text acl INTO STRICT p FROM pg_proc
 WHERE oid='public.reenter_tournament_player(uuid,bigint,bigint,text)'::regprocedure;
 IF p.definition_hash IS DISTINCT FROM '362ead3a68b64614fce7137363cb918c'
 OR p.proowner IS DISTINCT FROM 'postgres'::regrole OR NOT p.prosecdef
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
 OR p.acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
 OR NOT has_function_privilege('authenticated','public.reenter_tournament_player(uuid,bigint,bigint,text)','EXECUTE')
 THEN RAISE EXCEPTION 'canonical_cashier_reentry60_drift'; END IF;
END $postcheck$;
COMMIT;
\echo LEGACY_REENTRY60_OBJECT_POSTCHECK_PASS
