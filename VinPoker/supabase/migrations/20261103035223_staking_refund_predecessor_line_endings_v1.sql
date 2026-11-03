-- Release compatibility candidate. Explicit order: after244, before254.
-- Preserve the historical254 checksum gate; only its predecessor body's
-- LF/CRLF representation changes. No function logic, grants or business rows.
-- Recovery before254: reverse CRLF in prosrc after the same normalized hash
-- and metadata preflight. After254 keep this compatible definition in place.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $bridge$
DECLARE
 target regprocedure:='public.commit_staking_refund_v1(uuid,uuid,uuid,text)'::regprocedure;
 definition text; body text; replacement text; before_meta jsonb; after_meta jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 SELECT pg_get_functiondef(oid),prosrc,
   to_jsonb(p)-ARRAY['prosrc','xmin','cmin','xmax','cmax','ctid']
 INTO definition,body,before_meta FROM pg_proc p WHERE oid=target;
 IF md5(replace(definition,chr(13),''))<>'4863f2eea296cbe7d741cf6108fc031d'
 OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
   OR proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
   OR proconfig IS DISTINCT FROM ARRAY['search_path=""'] FROM pg_proc WHERE oid=target)
 OR to_regclass('public.staking_refund_email_intents_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'staking_refund_line_endings_predecessor_drift';
 END IF;
 IF md5(definition)='311b3d0b451fd6bfa15424921e193ded' THEN RETURN; END IF;
 IF md5(definition)<>'4863f2eea296cbe7d741cf6108fc031d'
 OR position(chr(13) IN body)>0
 OR position('$function$'||body||'$function$' IN definition)=0 THEN
  RAISE EXCEPTION 'staking_refund_line_endings_representation_drift';
 END IF;
 replacement:=replace(definition,'$function$'||body||'$function$',
   '$function$'||replace(body,chr(10),chr(13)||chr(10))||'$function$');
 EXECUTE replacement;
 SELECT to_jsonb(p)-ARRAY['prosrc','xmin','cmin','xmax','cmax','ctid']
 INTO after_meta FROM pg_proc p WHERE oid=target;
 IF before_meta IS DISTINCT FROM after_meta
 OR md5(pg_get_functiondef(target))<>'311b3d0b451fd6bfa15424921e193ded'
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'4863f2eea296cbe7d741cf6108fc031d' THEN
  RAISE EXCEPTION 'staking_refund_line_endings_postcheck_drift';
 END IF;
END;
$bridge$;
COMMIT;
