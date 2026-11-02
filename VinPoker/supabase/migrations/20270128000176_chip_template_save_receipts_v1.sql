-- CLI candidate20261019005421 reserved as unused local campaign176. NOT LIVE.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $pre$
BEGIN
 IF current_user<>'postgres'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.chip_ops_save_stack_template(uuid,text,bigint,jsonb)')) IS DISTINCT FROM 'f3118bbfd9c7bfb41efac91e6a0d7803'
 OR to_regnamespace('private') IS NULL
 OR to_regclass('private.chip_template_save_receipts_v1') IS NOT NULL
 OR to_regprocedure('public.chip_ops_save_stack_template_v2(uuid,uuid,text,bigint,jsonb,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.get_chip_template_save_receipt_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid)') IS NOT NULL
 OR to_regprocedure('public.cancel_chip_template_save_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000176') THEN
  RAISE EXCEPTION 'chip_template176_catalog_drift_or_collision';
 END IF;
END $pre$;

CREATE TABLE private.chip_template_save_receipts_v1(
 actor_id uuid NOT NULL,request_id uuid NOT NULL,tournament_id uuid NOT NULL,club_id uuid NOT NULL,
 payload_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE private.chip_template_save_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.chip_template_save_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.chip_template_save_context_v1(p_tournament_id uuid,p_chip_set_id uuid,p_name text,p_stack_value bigint,p_lines jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS TABLE(actor_id uuid,club_id uuid,payload_hash text,canonical_name text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE canonical_lines jsonb;
BEGIN
 actor_id:=auth.uid();
 IF actor_id IS NULL OR actor_id IS DISTINCT FROM p_expected_actor THEN RAISE EXCEPTION 'chip_template_actor_required' USING ERRCODE='42501';END IF;
 SELECT t.club_id INTO club_id FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND' USING ERRCODE='22023';END IF;
 IF NOT(coalesce(public.is_club_owner(actor_id,club_id),false) OR coalesce(public.is_club_chip_master(actor_id,club_id),false)) THEN
  RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR p_chip_set_id IS NULL OR p_name IS NULL OR btrim(p_name)=''
 OR p_stack_value IS NULL OR p_stack_value<=0 OR p_stack_value>9007199254740991
 OR p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' THEN
  RAISE EXCEPTION 'chip_template_invalid_intent' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_lines)=0 THEN RAISE EXCEPTION 'chip_template_invalid_intent' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE jsonb_typeof(x)<>'object'
 OR x-ARRAY['denomination_id','count']<>'{}'::jsonb OR NOT(x ?& ARRAY['denomination_id','count'])
 OR jsonb_typeof(x->'denomination_id')<>'string' OR jsonb_typeof(x->'count')<>'number'
 OR (x->>'count')::numeric<>trunc((x->>'count')::numeric) OR (x->>'count')::numeric NOT BETWEEN 1 AND 2147483647) THEN
  RAISE EXCEPTION 'chip_template_invalid_lines' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(x ORDER BY x->>'denomination_id') INTO canonical_lines FROM jsonb_array_elements(p_lines) x;
 canonical_name:=btrim(p_name);
 payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('operation','chip-template-save-v1',
  'tournament',p_tournament_id,'club',club_id,'set',p_chip_set_id,'name',canonical_name,
  'stack',p_stack_value,'lines',canonical_lines)::text,'UTF8'),'sha256'),'hex');
 RETURN NEXT;
END $f$;

CREATE FUNCTION private.resolve_chip_template_save_v1(p_tournament_id uuid,p_chip_set_id uuid,p_name text,p_stack_value bigint,p_lines jsonb,p_request_id uuid,p_expected_actor uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE ctx record;prior private.chip_template_save_receipts_v1%ROWTYPE;result jsonb;answer jsonb;
 actual_club uuid;bound uuid;binding_club uuid;deleted timestamptz;failure text;template_id uuid;
BEGIN
 IF p_action NOT IN('apply','lookup','cancel') OR p_action IS NULL THEN RAISE EXCEPTION 'chip_template_invalid_action';END IF;
 SELECT * INTO ctx FROM private.chip_template_save_context_v1(p_tournament_id,p_chip_set_id,p_name,p_stack_value,p_lines,p_request_id,p_expected_actor);
 IF p_action<>'lookup' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('chip-template-save:'||ctx.actor_id||':'||p_request_id,0));
  SELECT * INTO ctx FROM private.chip_template_save_context_v1(p_tournament_id,p_chip_set_id,p_name,p_stack_value,p_lines,p_request_id,p_expected_actor);
 END IF;
 SELECT * INTO prior FROM private.chip_template_save_receipts_v1 r WHERE r.actor_id=ctx.actor_id AND r.request_id=p_request_id;
 IF FOUND THEN
  IF prior.payload_hash IS DISTINCT FROM ctx.payload_hash OR prior.club_id IS DISTINCT FROM ctx.club_id OR prior.tournament_id IS DISTINCT FROM p_tournament_id THEN
   RAISE EXCEPTION 'chip_template_request_payload_conflict' USING ERRCODE='22023';END IF;
  RETURN prior.response;
 END IF;
 IF p_action='lookup' THEN RETURN NULL;END IF;
 IF p_action='apply' THEN
  SELECT t.club_id,t.deleted_at INTO actual_club,deleted FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR deleted IS NOT NULL THEN failure:='TOURNAMENT_NOT_FOUND';
  ELSIF actual_club IS DISTINCT FROM ctx.club_id THEN RAISE EXCEPTION 'chip_template_scope_changed' USING ERRCODE='40001';
  ELSE
   SELECT b.chip_set_id,b.club_id INTO bound,binding_club FROM public.tournament_chip_set b WHERE b.tournament_id=p_tournament_id FOR UPDATE;
   IF NOT FOUND THEN failure:='NO_CHIP_SET_BINDING';
   ELSIF bound IS DISTINCT FROM p_chip_set_id OR binding_club IS DISTINCT FROM ctx.club_id THEN failure:='CHIP_SET_BINDING_CHANGED_RELOAD';END IF;
  END IF;
  IF failure IS NULL THEN
   -- Existing canonical primitive retains denomination, sum, unique-name and FK rules.
   result:=public.chip_ops_save_stack_template(p_tournament_id,ctx.canonical_name,p_stack_value,p_lines);
   failure:=result->>'error';
   IF failure IS NULL THEN
    template_id:=(result->>'stack_template_id')::uuid;
    IF result->>'status' IS DISTINCT FROM 'ok' OR template_id IS NULL
    OR (result->>'stack_value')::bigint IS DISTINCT FROM p_stack_value OR (result->>'sum')::bigint IS DISTINCT FROM p_stack_value
    OR NOT EXISTS(SELECT 1 FROM public.stack_template t WHERE t.id=template_id AND t.tournament_id=p_tournament_id
      AND t.club_id=ctx.club_id AND t.chip_set_id=p_chip_set_id AND t.created_by=ctx.actor_id AND t.name=ctx.canonical_name AND t.stack_value=p_stack_value) THEN
     RAISE EXCEPTION 'chip_template_unverified_commit' USING ERRCODE='23514';END IF;
   ELSIF failure NOT IN('Unauthorized','Forbidden','INVALID_INPUT','NO_CHIP_SET_BINDING','TOURNAMENT_NOT_FOUND','DUPLICATE_DENOM','DENOM_NOT_IN_SET','NAME_EXISTS','STACK_SUM_MISMATCH') THEN
    RAISE EXCEPTION 'chip_template_unrecognized_rejection' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 answer:=jsonb_build_object('status',CASE WHEN failure IS NULL THEN 'ok' ELSE 'rejected' END,
  'outcome',CASE WHEN p_action='cancel' THEN 'cancelled' WHEN failure IS NOT NULL THEN 'rejected' ELSE 'saved' END,
  'actor_id',ctx.actor_id,'request_id',p_request_id,'tournament_id',p_tournament_id,'club_id',ctx.club_id,
  'chip_set_id',p_chip_set_id,'error',failure,'result',result);
 INSERT INTO private.chip_template_save_receipts_v1(actor_id,request_id,tournament_id,club_id,payload_hash,response)
 VALUES(ctx.actor_id,p_request_id,p_tournament_id,ctx.club_id,ctx.payload_hash,answer);
 RETURN answer;
END $f$;

CREATE FUNCTION public.chip_ops_save_stack_template_v2(p_tournament_id uuid,p_chip_set_id uuid,p_name text,p_stack_value bigint,p_lines jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.resolve_chip_template_save_v1(p_tournament_id,p_chip_set_id,p_name,p_stack_value,p_lines,p_request_id,p_expected_actor,'apply');
$f$;
CREATE FUNCTION public.get_chip_template_save_receipt_v1(p_tournament_id uuid,p_chip_set_id uuid,p_name text,p_stack_value bigint,p_lines jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.resolve_chip_template_save_v1(p_tournament_id,p_chip_set_id,p_name,p_stack_value,p_lines,p_request_id,p_expected_actor,'lookup');
$f$;
CREATE FUNCTION public.cancel_chip_template_save_v1(p_tournament_id uuid,p_chip_set_id uuid,p_name text,p_stack_value bigint,p_lines jsonb,p_request_id uuid,p_expected_actor uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.resolve_chip_template_save_v1(p_tournament_id,p_chip_set_id,p_name,p_stack_value,p_lines,p_request_id,p_expected_actor,'cancel');
$f$;
REVOKE ALL ON FUNCTION private.chip_template_save_context_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid),private.resolve_chip_template_save_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.chip_ops_save_stack_template_v2(uuid,uuid,text,bigint,jsonb,uuid,uuid),public.get_chip_template_save_receipt_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid),public.cancel_chip_template_save_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_save_stack_template_v2(uuid,uuid,text,bigint,jsonb,uuid,uuid),public.get_chip_template_save_receipt_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid),public.cancel_chip_template_save_v1(uuid,uuid,text,bigint,jsonb,uuid,uuid) TO authenticated;
COMMIT;
