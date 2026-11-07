-- Owner-reviewed rollback only. Disable the new worker/read path beforehand.
-- Restore the exact prior function; preserve source, jobs, counters and audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target oid; definition text; before_metadata jsonb; after_metadata jsonb;
 old_line text:='target:=coalesce(nullif(current_setting(''app.supabase_url'',true),''''),''https://orlesggcjamwuknxwcpk.supabase.co'');';
 new_line text:='target:=nullif(current_setting(''app.supabase_url'',true),'''');';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'hud_dispatch_owner_required';END IF;
 target:=to_regprocedure('public.dispatch_public_hud_projection_v1()');
 IF target IS NULL THEN RAISE EXCEPTION 'hud_dispatch_dependency_missing';END IF;
 SELECT replace(pg_get_functiondef(target),chr(13),'') INTO definition;
 IF md5(definition)<>'3806846a2f98caa07272e80775b4384a'
 OR (length(definition)-length(replace(definition,old_line,'')))/length(old_line)<>1
 THEN RAISE EXCEPTION 'hud_dispatch_definition_drift';END IF;
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,'volatile',provolatile)
 INTO STRICT before_metadata FROM pg_proc WHERE oid=target;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
  AND p.proconfig=ARRAY['search_path=""']::text[]
  AND (SELECT array_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END)
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE')=ARRAY['postgres','service_role']::text[]
  AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.is_grantable))
 THEN RAISE EXCEPTION 'hud_dispatch_metadata_drift';END IF;
 EXECUTE replace(definition,old_line,new_line);
 SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl,'volatile',provolatile)
 INTO STRICT after_metadata FROM pg_proc WHERE oid=target;
 IF before_metadata IS DISTINCT FROM after_metadata
 OR (SELECT md5(replace(pg_get_functiondef(target),chr(13),'')))<>'77a5d7ba1d22d52512f487f2a1e17d7e'
 THEN RAISE EXCEPTION 'hud_dispatch_postcheck_differs';END IF;
END $patch$;
COMMIT;
