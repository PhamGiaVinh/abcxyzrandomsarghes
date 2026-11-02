BEGIN;
-- CLI-created20261024193318; forward283. Keep original create intents/orders immutable.
DO $$ BEGIN
 IF md5(pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure))<>'83e587313eae6e15d665f5254e9467ef'
  OR md5(pg_get_functiondef('public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure))<>'04bac24e458317e0c9835af1114ee115' THEN
  RAISE EXCEPTION 'FNB_CREATE_FENCE_PREDECESSOR_DRIFT';
 END IF;
 IF to_regclass('floor_private.fnb_create_cancel_fences_v1') IS NOT NULL
  OR to_regprocedure('public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'FNB_CREATE_FENCE_NAMESPACE_COLLISION';
 END IF;
END $$;
CREATE TABLE floor_private.fnb_create_cancel_fences_v1(
 club_id uuid NOT NULL REFERENCES public.clubs(id),request_id text NOT NULL,actor_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('order','comp')),payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(club_id,request_id)
);
ALTER TABLE floor_private.fnb_create_cancel_fences_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.fnb_create_cancel_fences_v1 FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE definition text; marker text;
BEGIN
 definition:=pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure);
 marker:='  SELECT * INTO existing FROM public.fnb_create_intents_v1';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'FNB_CREATE_BIND_SEAM_DRIFT'; END IF;
 definition:=replace(definition,marker,$new$
  IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'FNB_CREATE_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';
  END IF;
  -- Both callers check admission before waiting. This check must be AFTER the request-key lock,
  -- including Comp's second wait after its separate club gate.
  IF NOT(public.is_club_fnb(p_actor,p_club) OR public.is_club_owner(p_actor,p_club))
   OR ((p_operation='comp' OR p_payload->>'source'='counter') AND NOT
    (public.is_club_fnb_kind(p_actor,p_club,'cashier') OR public.is_club_owner(p_actor,p_club))) THEN
   RAISE EXCEPTION 'Forbidden';
  END IF;
  IF EXISTS(SELECT 1 FROM floor_private.fnb_create_cancel_fences_v1 WHERE club_id=p_club AND request_id=p_key) THEN
   RETURN false; -- Late legacy/new writers cannot cross a committed fence, even with a changed actor/payload.
  END IF;
$new$||marker);
 EXECUTE definition;
 definition:=pg_get_functiondef('public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure);
 IF strpos(definition,' ), legacy AS (')=0 THEN RAISE EXCEPTION 'FNB_CREATE_RECEIPT_SEAM_DRIFT'; END IF;
 definition:=replace(definition,' ), legacy AS (',$new$
 ), fences AS (
  SELECT c.operation,c.payload FROM floor_private.fnb_create_cancel_fences_v1 c
  WHERE c.club_id=p_club_id AND c.request_id=p_request_id AND c.actor_id=actor
 ), legacy AS ($new$);
 definition:=replace(definition,'CASE WHEN EXISTS(SELECT 1 FROM bound) THEN (',
  'CASE WHEN EXISTS(SELECT 1 FROM bound) AND (EXISTS(SELECT 1 FROM bound WHERE id IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM fences)) THEN (');
 definition:=replace(definition,'WHEN EXISTS(SELECT 1 FROM legacy) THEN jsonb_build_object(''status'',''legacy_unverified'')',
  'WHEN EXISTS(SELECT 1 FROM legacy) THEN jsonb_build_object(''status'',''legacy_unverified'') WHEN EXISTS(SELECT 1 FROM fences) THEN (SELECT jsonb_build_object(''status'',''cancelled'',''operation'',operation,''intent'',payload) FROM fences)');
 EXECUTE definition;
END $patch$;

CREATE FUNCTION public.fnb_cancel_create_intent_v1(p_club_id uuid,p_request_id text,p_expected_actor uuid,p_operation text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor uuid:=auth.uid(); bound public.fnb_create_intents_v1%ROWTYPE; fence floor_private.fnb_create_cancel_fences_v1%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 IF p_expected_actor IS DISTINCT FROM actor THEN RAISE EXCEPTION 'FNB_CREATE_ACTOR_MISMATCH'; END IF;
 IF p_request_id IS NULL OR btrim(p_request_id)='' OR p_request_id<>btrim(p_request_id)
  OR p_operation IS NULL OR p_operation NOT IN('order','comp') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR p_payload->>'source' IS DISTINCT FROM 'counter' THEN RAISE EXCEPTION 'INVALID_REQUEST_ID_OR_PAYLOAD'; END IF;
 IF NOT(public.is_club_fnb_kind(actor,p_club_id,'cashier') OR public.is_club_owner(actor,p_club_id)) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'FNB_CREATE_READ_COMMITTED_REQUIRED' USING ERRCODE='40001';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_club_id::text||':'||p_request_id,0));
 IF NOT(public.is_club_fnb_kind(actor,p_club_id,'cashier') OR public.is_club_owner(actor,p_club_id)) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO bound FROM public.fnb_create_intents_v1 WHERE club_id=p_club_id AND request_id=p_request_id;
 IF FOUND AND (bound.actor_id IS DISTINCT FROM actor OR bound.operation IS DISTINCT FROM p_operation OR bound.payload IS DISTINCT FROM p_payload) THEN
  RAISE EXCEPTION 'REQUEST_ID_CONFLICT';
 END IF;
 IF EXISTS(SELECT 1 FROM public.fnb_orders WHERE club_id=p_club_id AND client_request_id=p_request_id) THEN
  IF bound.actor_id IS NULL THEN RAISE EXCEPTION 'FNB_CREATE_LEGACY_UNVERIFIED'; END IF;
  RETURN public.fnb_get_create_receipt_v1(p_club_id,p_request_id,actor); -- Never erase/cancel a committed order.
 END IF;
 SELECT * INTO fence FROM floor_private.fnb_create_cancel_fences_v1 WHERE club_id=p_club_id AND request_id=p_request_id;
 IF FOUND THEN
  IF fence.actor_id IS DISTINCT FROM actor OR fence.operation IS DISTINCT FROM p_operation OR fence.payload IS DISTINCT FROM p_payload THEN
   RAISE EXCEPTION 'REQUEST_ID_CONFLICT';
  END IF;
 ELSE
  INSERT INTO floor_private.fnb_create_cancel_fences_v1(club_id,request_id,actor_id,operation,payload)
  VALUES(p_club_id,p_request_id,actor,p_operation,p_payload);
 END IF;
 RETURN public.fnb_get_create_receipt_v1(p_club_id,p_request_id,actor);
END $function$;
REVOKE ALL ON FUNCTION public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_cancel_create_intent_v1(uuid,text,uuid,text,jsonb) TO authenticated;
COMMIT;
