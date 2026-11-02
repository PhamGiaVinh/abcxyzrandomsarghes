-- CLI-created forward candidate138. Never delete created tournaments to cancel
-- an unknown response. Same receipt lock fences a late writer after cancellation.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid)') IS NULL
 OR to_regprocedure('public.get_tournament_schedule_batch_receipt_v1(jsonb,uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'schedule batch137 required'; END IF;
END $$;
ALTER FUNCTION public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid) SET lock_timeout='5s';

CREATE FUNCTION public.cancel_tournament_schedule_batch_v1(
 p_rows jsonb,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; result jsonb;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
  RETURN jsonb_build_object('ok',false,'error','actor_changed'); END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_schedule_batch'); END IF;
 IF jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>100 THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_schedule_batch'); END IF;
 -- Cancelling an actor's own uncommitted intent does not grant club mutation
 -- authority, and must remain possible after their club access is revoked.
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM p_rows::text THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN receipt.result;
 END IF;
 result:=jsonb_build_object('ok',true,'outcome','cancelled','actor_id',actor,
  'request_id',p_request_id,'count',jsonb_array_length(p_rows));
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id,p_rows::text,result);
 RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_tournament_schedule_batch_v1(jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_tournament_schedule_batch_v1(jsonb,uuid,uuid) TO authenticated;
COMMIT;
