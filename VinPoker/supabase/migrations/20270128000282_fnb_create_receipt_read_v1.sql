BEGIN;
-- CLI-created20261024191006, forward282 reserved after filename/local catalog checks.
-- Read-only recovery. Absence is never a cancellation fence or permission to mint a new key.
DO $$ BEGIN
 IF to_regprocedure('public.fnb_get_create_receipt_v1(uuid,text,uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'FNB_CREATE_RECEIPT_NAMESPACE_COLLISION';
 END IF;
 IF to_regclass('public.fnb_create_intents_v1') IS NULL THEN
  RAISE EXCEPTION 'FNB_CREATE_INTENT_DEPENDENCY_MISSING';
 END IF;
END $$;
CREATE FUNCTION public.fnb_get_create_receipt_v1(p_club_id uuid,p_request_id text,p_expected_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor uuid:=auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 IF p_expected_actor IS DISTINCT FROM actor THEN RAISE EXCEPTION 'FNB_CREATE_ACTOR_MISMATCH'; END IF;
 IF p_request_id IS NULL OR btrim(p_request_id)='' OR p_request_id<>btrim(p_request_id) THEN
  RAISE EXCEPTION 'INVALID_REQUEST_ID';
 END IF;
 IF NOT (public.is_club_fnb(actor,p_club_id) OR public.is_club_owner(actor,p_club_id)) THEN
  RAISE EXCEPTION 'Forbidden';
 END IF;
 WITH bound AS (
  SELECT i.operation,i.payload,o.id,o.status,o.subtotal_vnd,o.is_comp
  FROM public.fnb_create_intents_v1 i LEFT JOIN public.fnb_orders o
   ON o.club_id=i.club_id AND o.client_request_id=i.request_id AND o.created_by=i.actor_id
  WHERE i.club_id=p_club_id AND i.request_id=p_request_id AND i.actor_id=actor
 ), legacy AS (
  SELECT 1 FROM public.fnb_orders WHERE club_id=p_club_id AND client_request_id=p_request_id AND created_by=actor
 )
 SELECT jsonb_build_object('actor_id',actor,'club_id',p_club_id,'request_id',p_request_id) ||
  CASE WHEN EXISTS(SELECT 1 FROM bound) THEN (
   SELECT jsonb_build_object('status',CASE WHEN id IS NOT NULL AND operation IN('order','comp')
      AND is_comp=(operation='comp') THEN 'found' ELSE 'unresolved' END,
    'operation',operation,'intent',payload,'order',CASE WHEN id IS NULL THEN NULL ELSE
      jsonb_build_object('id',id,'status',status,'subtotal_vnd',subtotal_vnd,'is_comp',is_comp) END)
   FROM bound
  ) WHEN EXISTS(SELECT 1 FROM legacy) THEN jsonb_build_object('status','legacy_unverified')
    ELSE jsonb_build_object('status','not_found') END INTO result;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.fnb_get_create_receipt_v1(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_get_create_receipt_v1(uuid,text,uuid) TO authenticated;
COMMIT;
