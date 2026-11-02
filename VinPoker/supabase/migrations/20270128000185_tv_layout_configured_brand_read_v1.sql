-- Additive read metadata only. Preserve effective display brand/fallback,
-- writer, ACL, layout revisions and immutable history. Rollback frontend first;
-- old clients ignore the additive field. No data rewrite is required.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE
 target regprocedure:='public.get_tv_tournament_branding_v1(uuid)'::regprocedure;
 definition text; before_meta jsonb; after_meta jsonb;
 anchor text:='    ''revision'', coalesce(l.revision, 0),';
BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000185')
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'9f00ec2ebe5b192031e7e04c6c9f3159' THEN
  RAISE EXCEPTION 'tv_configured_brand185_baseline_drift_or_collision';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_meta FROM pg_proc WHERE oid=target;
 IF before_meta->>'owner'<>'postgres' OR before_meta->>'definer'<>'true'
 OR before_meta->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb THEN
  RAISE EXCEPTION 'tv_configured_brand185_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN
  RAISE EXCEPTION 'tv_configured_brand185_anchor_drift';END IF;
 definition:=replace(definition,anchor,anchor||E'\n    ''configured_brand_name'', l.brand_name,');
 EXECUTE definition;
 IF replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN
  RAISE EXCEPTION 'tv_configured_brand185_definition_postcheck';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_meta FROM pg_proc WHERE oid=target;
 IF before_meta IS DISTINCT FROM after_meta THEN RAISE EXCEPTION 'tv_configured_brand185_metadata_changed';END IF;
END;
$patch$;
COMMIT;
