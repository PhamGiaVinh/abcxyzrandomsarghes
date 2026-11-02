-- Reject zero-stack restore; preserve receipts, history, authorization and locks.
-- Recovery: keep this integrity guard. If a caller is incompatible, contain new
-- restores by revoking its public restore RPC grant, not by restoring unsafe SQL.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:='floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure;
 definition text; before_meta jsonb; after_meta jsonb;
 anchor text:='v_busted_seat.chip_count < 0';
BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000187')
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'a63cd027ca476059f25e99d6818d6046' THEN
  RAISE EXCEPTION 'restore_positive187_baseline_drift_or_collision';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_meta FROM pg_proc WHERE oid=target;
 IF before_meta->>'owner'<>'postgres' OR before_meta->>'definer'<>'true'
 OR before_meta->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb
 OR before_meta->>'acl'<>'{postgres=X/postgres}' THEN RAISE EXCEPTION 'restore_positive187_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>3 THEN RAISE EXCEPTION 'restore_positive187_anchor_drift';END IF;
 definition:=replace(definition,anchor,'v_busted_seat.chip_count <= 0');
 EXECUTE definition;
 IF replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN RAISE EXCEPTION 'restore_positive187_definition_postcheck';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_meta FROM pg_proc WHERE oid=target;
 IF before_meta IS DISTINCT FROM after_meta THEN RAISE EXCEPTION 'restore_positive187_metadata_changed';END IF;
END;
$patch$;
COMMIT;
