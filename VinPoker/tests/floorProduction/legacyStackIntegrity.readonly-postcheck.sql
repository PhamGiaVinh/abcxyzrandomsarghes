BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT oid,proowner,prosecdef,proconfig,proacl,
 md5(replace(pg_get_functiondef(oid),chr(13),'')) digest
 FROM pg_proc WHERE oid IN ('public.update_stack(uuid,uuid,integer,integer)'::regprocedure,
 'public.bulk_update_stacks(uuid,jsonb)'::regprocedure) LOOP
 IF p.proowner<>'postgres'::regrole OR p.prosecdef
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 OR p.digest NOT IN ('f1b7046258e983970bb655011a9e9653','97b6c96a53aedede2a76b89da8dd684f')
 OR has_function_privilege('anon',p.oid,'EXECUTE')
 OR has_function_privilege('service_role',p.oid,'EXECUTE')
 OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 THEN RAISE EXCEPTION 'stack61_retirement_object_drift'; END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=
 'public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text,text)'::regprocedure;
 IF md5(replace(pg_get_functiondef(p.oid),chr(13),''))<>'a04bbb425ed15913bd8ee2368256f25a'
 OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
 THEN RAISE EXCEPTION 'stack61_canonical_object_changed'; END IF;
END $$;
COMMIT;
\echo STACK61_OBJECT_POSTCHECK_PASS
