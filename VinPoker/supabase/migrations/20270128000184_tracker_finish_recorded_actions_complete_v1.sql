-- CLI candidate20261019114421; forward slot184. LOCAL qualification only.
-- Finish cannot omit already-recorded source actions. Explicit undo/correction
-- remains a separate authorized operation; no history, payout or winner rewrite.
-- Containment: suspend manual Finish entrypoint, preserve receipts/history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $patch$
DECLARE
 target regprocedure:='public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
 definition text; metadata_before jsonb; metadata_after jsonb;
 anchor text:='    JOIN actions incoming ON incoming.action_order = existing.action_order';
 replacement text:='    LEFT JOIN actions incoming ON incoming.action_order = existing.action_order';
BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000184')
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'07b21673ee6afe3a85643914fe4b97b6'
 OR md5(replace(pg_get_functiondef('public.record_tracker_manual_hand_v1(jsonb)'::regprocedure),chr(13),''))<>'29c8223e91774dc4767ab72a334e7b56'
 OR md5(replace(pg_get_functiondef('floor_private.tracker_manual_pots_match_v1(jsonb,jsonb,integer)'::regprocedure),chr(13),''))<>'1c2d7ac7002c77ecae33002c13110203' THEN
  RAISE EXCEPTION 'tracker_finish184_baseline_drift_or_collision';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO metadata_before FROM pg_proc WHERE oid=target;
 IF metadata_before->>'owner'<>'postgres' OR metadata_before->>'definer'<>'true'
 OR metadata_before->>'acl'<>'{postgres=X/postgres}'
 OR metadata_before->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb THEN
  RAISE EXCEPTION 'tracker_finish184_authority_drift';
 END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN
  RAISE EXCEPTION 'tracker_finish184_action_guard_anchor_drift';
 END IF;
 -- The existing IS DISTINCT FROM checks now also see NULL incoming columns
 -- for a recorded action missing from the request. Reject before any writes.
 definition:=replace(definition,anchor,replacement);
 EXECUTE definition;
 IF replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN
  RAISE EXCEPTION 'tracker_finish184_definition_postcheck';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO metadata_after FROM pg_proc WHERE oid=target;
 IF metadata_before IS DISTINCT FROM metadata_after THEN
  RAISE EXCEPTION 'tracker_finish184_metadata_postcheck';
 END IF;
END;
$patch$;
COMMIT;
