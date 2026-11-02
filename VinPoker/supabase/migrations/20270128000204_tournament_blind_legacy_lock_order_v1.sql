-- CLI generated20261020073754; forward204 collision checked. Requires203 helper.
-- Lock-order only: preserve invoker/RLS, parsing, return shapes and function ACL.
-- Roll back DDL transaction before qualification; contain by suspending affected
-- legacy RPCs, never by disabling RLS or restoring child-first lock order.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000204')
 OR md5(replace(pg_get_functiondef('public._lock_tournament_blind_parent_v1(uuid)'::regprocedure),chr(13),''))<>'b117fa0fdc991e86eee6ee01066ac8ca'
 OR md5(replace(pg_get_functiondef('public.import_blind_structure(uuid,text)'::regprocedure),chr(13),''))<>'7795c101cf451f6170192d88e502242d'
 OR md5(replace(pg_get_functiondef('public.update_tournament_blinds(uuid,jsonb)'::regprocedure),chr(13),''))<>'9b6e78a222eee79dfe3f7ae7daf6a128'
 THEN RAISE EXCEPTION 'blind204_dependency_or_catalog_drift';END IF;
END $$;
DO $$ DECLARE signature text;definition text;acl aclitem[];marker text:=E'BEGIN\n';BEGIN
 FOREACH signature IN ARRAY ARRAY['public.import_blind_structure(uuid,text)','public.update_tournament_blinds(uuid,jsonb)'] LOOP
  SELECT replace(pg_get_functiondef(oid),chr(13),''),proacl INTO definition,acl FROM pg_proc
  WHERE oid=signature::regprocedure AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig IS NULL;
  IF definition IS NULL OR array_length(string_to_array(definition,marker),1)<>2
  THEN RAISE EXCEPTION 'blind204_owner_invoker_or_body_drift_%',signature;END IF;
  definition:=replace(definition,marker,marker||E'    PERFORM public._lock_tournament_blind_parent_v1(p_tournament_id);\n');
  EXECUTE definition;
  IF (SELECT proacl FROM pg_proc WHERE oid=signature::regprocedure) IS DISTINCT FROM acl
  OR (SELECT prosecdef FROM pg_proc WHERE oid=signature::regprocedure)
  THEN RAISE EXCEPTION 'blind204_acl_or_invoker_changed_%',signature;END IF;
 END LOOP;
END $$;
COMMIT;
