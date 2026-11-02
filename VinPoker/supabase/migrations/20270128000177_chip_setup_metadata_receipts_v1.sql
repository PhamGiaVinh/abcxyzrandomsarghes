-- CLI candidate20261019064241 reserved as unused local version177. NOT LIVE.
-- Durable intents around the existing bind/add/delete primitives, not inventory writes.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $pre$
BEGIN
 IF current_user<>'postgres'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_bind_tournament_chip_set(uuid,uuid)')) IS DISTINCT FROM '2af8685a6bb091952f32e5fc92969e0b'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_add_denomination(uuid,bigint,text,text,integer)')) IS DISTINCT FROM '7e1efc76559f998de8d7bdd8c0fbbf15'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_delete_denomination(uuid)')) IS DISTINCT FROM 'a312af5f430edf2cf7cd69105989e60e'
 OR to_regnamespace('private') IS NULL
 OR to_regclass('private.chip_setup_metadata_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.chip_ops_apply_setup_metadata_v1(uuid,jsonb,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_chip_setup_metadata_receipt_v1(uuid,jsonb,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.cancel_chip_setup_metadata_v1(uuid,jsonb,uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000177') THEN
  RAISE EXCEPTION 'chip_metadata177_catalog_drift_or_collision';END IF;
END $pre$;

CREATE TABLE private.chip_setup_metadata_receipts_v1(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,tournament_id uuid NOT NULL,club_id uuid NOT NULL,
 payload_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.chip_setup_metadata_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.chip_setup_metadata_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.chip_setup_metadata_context_v1(p_tournament_id uuid,p_payload jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS TABLE(actor_id uuid,club_id uuid,payload_hash text,operation text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 actor_id:=auth.uid();
 IF actor_id IS NULL OR actor_id IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'chip_metadata_actor_required' USING ERRCODE='42501';END IF;
 SELECT t.club_id INTO club_id FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND' USING ERRCODE='22023';END IF;
 IF club_id IS NULL OR NOT(coalesce(public.is_club_owner(actor_id,club_id),false) OR coalesce(public.is_club_chip_master(actor_id,club_id),false)) THEN
  RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR jsonb_typeof(p_payload->'operation') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION 'chip_metadata_invalid_intent' USING ERRCODE='22023';END IF;
 operation:=p_payload->>'operation';
 IF jsonb_typeof(p_payload->'chip_set_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'chip_metadata_invalid_set' USING ERRCODE='22023';END IF;
 PERFORM (p_payload->>'chip_set_id')::uuid;
 IF operation='bind' THEN
  IF NOT(p_payload ?& ARRAY['operation','chip_set_id','expected_chip_set_id']) OR p_payload-ARRAY['operation','chip_set_id','expected_chip_set_id']<>'{}'::jsonb
    OR jsonb_typeof(p_payload->'expected_chip_set_id') NOT IN('null','string') THEN RAISE EXCEPTION 'chip_metadata_invalid_bind' USING ERRCODE='22023';END IF;
  PERFORM (p_payload->>'expected_chip_set_id')::uuid;
 ELSIF operation='add' THEN
  IF NOT(p_payload ?& ARRAY['operation','chip_set_id','value','color','label','display_order']) OR p_payload-ARRAY['operation','chip_set_id','value','color','label','display_order']<>'{}'::jsonb
   OR jsonb_typeof(p_payload->'value') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'display_order') IS DISTINCT FROM 'number'
   OR jsonb_typeof(p_payload->'color') NOT IN('null','string') OR jsonb_typeof(p_payload->'label') NOT IN('null','string') THEN
    RAISE EXCEPTION 'chip_metadata_invalid_add' USING ERRCODE='22023';END IF;
  IF (p_payload->>'value')::numeric<>trunc((p_payload->>'value')::numeric) OR (p_payload->>'value')::numeric NOT BETWEEN 1 AND 9007199254740991
   OR (p_payload->>'display_order')::numeric<>trunc((p_payload->>'display_order')::numeric) OR (p_payload->>'display_order')::numeric NOT BETWEEN 0 AND 2147483647 THEN
    RAISE EXCEPTION 'chip_metadata_invalid_add' USING ERRCODE='22023';END IF;
 ELSIF operation='delete' THEN
  IF NOT(p_payload ?& ARRAY['operation','chip_set_id','denomination_id']) OR p_payload-ARRAY['operation','chip_set_id','denomination_id']<>'{}'::jsonb
   OR jsonb_typeof(p_payload->'denomination_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'chip_metadata_invalid_delete' USING ERRCODE='22023';END IF;
  PERFORM (p_payload->>'denomination_id')::uuid;
 ELSE RAISE EXCEPTION 'chip_metadata_invalid_operation' USING ERRCODE='22023';END IF;
 payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('intent','chip-setup-metadata-v1','tournament',p_tournament_id,
   'club',club_id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 RETURN NEXT;
END $f$;

CREATE FUNCTION private.resolve_chip_setup_metadata_v1(p_tournament_id uuid,p_payload jsonb,p_request_id uuid,p_expected_actor uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE ctx record;prior private.chip_setup_metadata_receipts_v1%ROWTYPE;result jsonb;answer jsonb;failure text;
 target_set uuid;bound uuid;binding_club uuid;target_club uuid;actual_club uuid;deleted timestamptz;denom uuid;denom_set uuid;denom_club uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('apply','lookup','cancel') THEN RAISE EXCEPTION 'chip_metadata_invalid_action';END IF;
 SELECT * INTO ctx FROM private.chip_setup_metadata_context_v1(p_tournament_id,p_payload,p_request_id,p_expected_actor);
 IF p_action<>'lookup' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('chip-setup-metadata:'||ctx.actor_id||':'||p_request_id,0));
  SELECT * INTO ctx FROM private.chip_setup_metadata_context_v1(p_tournament_id,p_payload,p_request_id,p_expected_actor);
 END IF;
 SELECT * INTO prior FROM private.chip_setup_metadata_receipts_v1 r WHERE r.actor_id=ctx.actor_id AND r.request_id=p_request_id;
 IF FOUND THEN
  IF prior.payload_hash IS DISTINCT FROM ctx.payload_hash OR prior.tournament_id IS DISTINCT FROM p_tournament_id OR prior.club_id IS DISTINCT FROM ctx.club_id THEN
   RAISE EXCEPTION 'chip_metadata_request_payload_conflict' USING ERRCODE='22023';END IF;
  RETURN prior.response;
 END IF;
 IF p_action='lookup' THEN RETURN NULL;END IF;
 IF p_action='apply' THEN
  -- Same parent/binding order as171/176. No arbitrary RPC dispatch or dynamic SQL.
  SELECT t.club_id,t.deleted_at INTO actual_club,deleted FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR deleted IS NOT NULL THEN failure:='TOURNAMENT_NOT_FOUND';
  ELSIF actual_club IS DISTINCT FROM ctx.club_id THEN RAISE EXCEPTION 'chip_metadata_scope_changed' USING ERRCODE='40001';
  ELSE
   SELECT b.chip_set_id,b.club_id INTO bound,binding_club FROM public.tournament_chip_set b WHERE b.tournament_id=p_tournament_id FOR UPDATE;
   IF FOUND AND binding_club IS DISTINCT FROM ctx.club_id THEN failure:='CHIP_SET_BINDING_SCOPE_INVALID';
   ELSIF ctx.operation='bind' THEN
    IF bound IS DISTINCT FROM (p_payload->>'expected_chip_set_id')::uuid THEN failure:='CHIP_SET_BINDING_CHANGED_RELOAD';END IF;
   ELSIF bound IS NULL THEN failure:='NO_CHIP_SET_BINDING';
   ELSIF bound IS DISTINCT FROM (p_payload->>'chip_set_id')::uuid THEN failure:='CHIP_SET_BINDING_CHANGED_RELOAD';END IF;
  END IF;
  target_set:=(p_payload->>'chip_set_id')::uuid;
  IF failure IS NULL THEN
   SELECT s.club_id INTO target_club FROM public.chip_set s WHERE s.id=target_set FOR SHARE;
   IF NOT FOUND THEN failure:='CHIP_SET_NOT_FOUND';
   ELSIF target_club IS DISTINCT FROM ctx.club_id THEN failure:='CHIP_SET_CLUB_MISMATCH';END IF;
  END IF;
  IF failure IS NULL THEN
   IF ctx.operation='bind' THEN result:=public.chip_ops_bind_tournament_chip_set(p_tournament_id,target_set);
   ELSIF ctx.operation='add' THEN result:=public.chip_ops_add_denomination(target_set,(p_payload->>'value')::bigint,p_payload->>'color',p_payload->>'label',(p_payload->>'display_order')::integer);
   ELSE
    denom:=(p_payload->>'denomination_id')::uuid;
    SELECT d.chip_set_id,d.club_id INTO denom_set,denom_club FROM public.chip_set_denomination d WHERE d.id=denom FOR UPDATE;
    IF NOT FOUND THEN failure:='DENOM_NOT_FOUND';
    ELSIF denom_set IS DISTINCT FROM target_set OR denom_club IS DISTINCT FROM ctx.club_id THEN failure:='DENOM_NOT_IN_SET';
    ELSE result:=public.chip_ops_delete_denomination(denom);END IF;
   END IF;
   failure:=coalesce(failure,result->>'error');
   IF failure IS NULL THEN
    IF result->>'status' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'chip_metadata_unverified_commit' USING ERRCODE='23514';END IF;
    IF ctx.operation='bind' THEN
     IF result->>'action' IS NULL OR result->>'action' NOT IN('bound','unchanged','rebound') OR (result->>'chip_set_id')::uuid IS DISTINCT FROM target_set
      OR NOT EXISTS(SELECT 1 FROM public.tournament_chip_set b WHERE b.tournament_id=p_tournament_id AND b.chip_set_id=target_set AND b.club_id=ctx.club_id) THEN
       RAISE EXCEPTION 'chip_metadata_unverified_binding' USING ERRCODE='23514';END IF;
    ELSIF ctx.operation='add' THEN
     denom:=(result->>'denomination_id')::uuid;
     IF denom IS NULL OR NOT EXISTS(SELECT 1 FROM public.chip_set_denomination d WHERE d.id=denom AND d.chip_set_id=target_set AND d.club_id=ctx.club_id
      AND d.value=(p_payload->>'value')::bigint AND d.color IS NOT DISTINCT FROM p_payload->>'color' AND d.label IS NOT DISTINCT FROM p_payload->>'label'
      AND d.display_order=(p_payload->>'display_order')::integer AND d.created_by=ctx.actor_id) THEN
       RAISE EXCEPTION 'chip_metadata_unverified_denomination' USING ERRCODE='23514';END IF;
    ELSE
     IF (result->>'denomination_id')::uuid IS DISTINCT FROM denom OR EXISTS(SELECT 1 FROM public.chip_set_denomination d WHERE d.id=denom) THEN
      RAISE EXCEPTION 'chip_metadata_unverified_delete' USING ERRCODE='23514';END IF;
    END IF;
   ELSIF failure NOT IN('Unauthorized','Forbidden','INVALID_INPUT','TOURNAMENT_NOT_FOUND','CHIP_SET_NOT_FOUND','CHIP_SET_CLUB_MISMATCH','BINDING_LOCKED_TEMPLATES_EXIST','VALUE_EXISTS','DENOM_NOT_FOUND','DENOM_IN_USE','DENOM_NOT_IN_SET') THEN
    RAISE EXCEPTION 'chip_metadata_unrecognized_rejection' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 answer:=jsonb_build_object('status',CASE WHEN failure IS NULL THEN 'ok' ELSE 'rejected' END,
  'outcome',CASE WHEN p_action='cancel' THEN 'cancelled' WHEN failure IS NULL THEN 'applied' ELSE 'rejected' END,
  'actor_id',ctx.actor_id,'club_id',ctx.club_id,'tournament_id',p_tournament_id,'request_id',p_request_id,
  'payload',p_payload,'error',failure,'result',result);
 INSERT INTO private.chip_setup_metadata_receipts_v1(actor_id,request_id,tournament_id,club_id,payload_hash,response)
 VALUES(ctx.actor_id,p_request_id,p_tournament_id,ctx.club_id,ctx.payload_hash,answer);
 RETURN answer;
END $f$;

CREATE FUNCTION public.chip_ops_apply_setup_metadata_v1(p_tournament_id uuid,p_payload jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.resolve_chip_setup_metadata_v1(p_tournament_id,p_payload,p_request_id,p_expected_actor,'apply');
$f$;
CREATE FUNCTION public.get_chip_setup_metadata_receipt_v1(p_tournament_id uuid,p_payload jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.resolve_chip_setup_metadata_v1(p_tournament_id,p_payload,p_request_id,p_expected_actor,'lookup');
$f$;
CREATE FUNCTION public.cancel_chip_setup_metadata_v1(p_tournament_id uuid,p_payload jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.resolve_chip_setup_metadata_v1(p_tournament_id,p_payload,p_request_id,p_expected_actor,'cancel');
$f$;
REVOKE ALL ON FUNCTION private.chip_setup_metadata_context_v1(uuid,jsonb,uuid,uuid),private.resolve_chip_setup_metadata_v1(uuid,jsonb,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.chip_ops_apply_setup_metadata_v1(uuid,jsonb,uuid,uuid),public.get_chip_setup_metadata_receipt_v1(uuid,jsonb,uuid,uuid),public.cancel_chip_setup_metadata_v1(uuid,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_apply_setup_metadata_v1(uuid,jsonb,uuid,uuid),public.get_chip_setup_metadata_receipt_v1(uuid,jsonb,uuid,uuid),public.cancel_chip_setup_metadata_v1(uuid,jsonb,uuid,uuid) TO authenticated;
COMMIT;
