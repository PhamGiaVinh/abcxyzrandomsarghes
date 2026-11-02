-- CLI generated20261024041243; forward276 collision checked after275.
-- Read-only recovery for normal redraw, independent of the active-only TV view.
-- Recovery: hold new UI reader, revoke this exact function via forward review;
-- retain every writer receipt/batch/seat. No historical or business writes.
BEGIN;
DO $pre$
DECLARE r record;
BEGIN
 IF current_user<>'postgres' OR to_regprocedure('public.floor_get_redraw_intent_v1(uuid,text,uuid,jsonb,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'redraw276_namespace_or_actor_drift';END IF;
 FOR r IN SELECT * FROM (VALUES
  ('public.floor_plan_tournament_redraw_v1(uuid,integer,uuid[],uuid)','7d432f2e9206f9fb4b8b4bc5e91758ee'),
  ('public.floor_apply_tournament_redraw_v1(uuid,uuid)','33749f791cfba4f910d24318ab2d3b65'),
  ('public.floor_continue_tournament_redraw_v1(uuid,bigint,uuid)','40312f47bd30e55a213a58404d052019')) v(signature,digest)
 LOOP
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure(r.signature)) IS DISTINCT FROM r.digest
  THEN RAISE EXCEPTION 'redraw276_writer_definition_drift: %',r.signature;END IF;
 END LOOP;
END $pre$;
CREATE FUNCTION public.floor_get_redraw_intent_v1(
 p_tournament_id uuid,p_operation text,p_request_id uuid,p_payload jsonb,p_expected_actor uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; canonical jsonb; ids jsonb; batch uuid;
 operation_name text; receipt public.table_operation_receipts%ROWTYPE; envelope jsonb; key_count integer;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor THEN RETURN jsonb_build_object('error','ACTOR_MISMATCH');END IF;
 IF p_tournament_id IS NULL OR p_request_id IS NULL OR p_operation IS NULL
  OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
 THEN RETURN jsonb_build_object('error','invalid_request');END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,club)
 THEN RETURN jsonb_build_object('error','actor_not_allowed');END IF;
 SELECT count(*) INTO key_count FROM jsonb_object_keys(p_payload);
 CASE p_operation
 WHEN 'plan' THEN
  IF key_count<>3 OR NOT (p_payload ?& ARRAY['tournament_id','target_max_seats','game_table_ids'])
   OR jsonb_typeof(p_payload->'target_max_seats')<>'number' OR p_payload->>'target_max_seats' NOT IN('8','9')
   OR (p_payload->>'tournament_id')::uuid IS DISTINCT FROM p_tournament_id
   OR jsonb_typeof(p_payload->'game_table_ids')<>'array'
  THEN RETURN jsonb_build_object('error','invalid_request');END IF;
  IF jsonb_array_length(p_payload->'game_table_ids') NOT BETWEEN 1 AND 100
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_payload->'game_table_ids') x
      WHERE x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  THEN RETURN jsonb_build_object('error','invalid_request');END IF;
  IF (SELECT count(DISTINCT x::uuid) FROM jsonb_array_elements_text(p_payload->'game_table_ids') x)
    <>jsonb_array_length(p_payload->'game_table_ids') THEN RETURN jsonb_build_object('error','invalid_request');END IF;
  SELECT jsonb_agg(x::uuid ORDER BY x::uuid) INTO ids FROM jsonb_array_elements_text(p_payload->'game_table_ids') x;
  canonical:=jsonb_build_object('tournament_id',p_tournament_id,'target_max_seats',(p_payload->>'target_max_seats')::integer,'game_table_ids',ids);
  operation_name:='floor_plan_tournament_redraw_v1';
 WHEN 'apply','continue' THEN
  IF key_count<>(CASE WHEN p_operation='apply' THEN 1 ELSE 2 END)
   OR NOT (p_payload ? 'batch_id') OR jsonb_typeof(p_payload->'batch_id')<>'string'
  THEN RETURN jsonb_build_object('error','invalid_request');END IF;
  batch:=(p_payload->>'batch_id')::uuid;
  IF p_operation='apply' THEN
   canonical:=jsonb_build_object('batch_id',batch);operation_name:='floor_apply_tournament_redraw_v1';
  ELSE
   IF NOT (p_payload ? 'expected_redraw_revision') OR jsonb_typeof(p_payload->'expected_redraw_revision')<>'number'
    OR (p_payload->>'expected_redraw_revision')::bigint<1 THEN RETURN jsonb_build_object('error','invalid_request');END IF;
   canonical:=jsonb_build_object('batch_id',batch,'expected_redraw_revision',(p_payload->>'expected_redraw_revision')::bigint);
   operation_name:='floor_continue_tournament_redraw_v1';
  END IF;
 ELSE RETURN jsonb_build_object('error','invalid_operation');
 END CASE;
 envelope:=jsonb_build_object('actor_id',actor,'tournament_id',p_tournament_id,'operation',p_operation,'request_id',p_request_id,'payload',canonical);
 SELECT * INTO receipt FROM public.table_operation_receipts r
  WHERE r.actor_id=actor AND r.operation_type=operation_name AND r.request_id=p_request_id;
 IF NOT FOUND THEN
  IF batch IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_redraw_batches b WHERE b.id=batch AND b.tournament_id=p_tournament_id)
  THEN RETURN jsonb_build_object('error','redraw_batch_not_found');END IF;
  RETURN envelope||jsonb_build_object('status','unknown');
 END IF;
 IF receipt.request_fingerprint IS DISTINCT FROM canonical::text
 THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');END IF;
 IF batch IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_redraw_batches b WHERE b.id=batch AND b.tournament_id=p_tournament_id)
 THEN RETURN jsonb_build_object('error','redraw_receipt_scope_changed');END IF;
 IF receipt.result->>'batch_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tournament_redraw_batches b
    WHERE b.id=(receipt.result->>'batch_id')::uuid AND b.tournament_id=p_tournament_id)
 THEN RETURN jsonb_build_object('error','redraw_receipt_scope_changed');END IF;
 RETURN envelope||jsonb_build_object('status','found','result',receipt.result);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('error','invalid_request');
END $$;
ALTER FUNCTION public.floor_get_redraw_intent_v1(uuid,text,uuid,jsonb,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.floor_get_redraw_intent_v1(uuid,text,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.floor_get_redraw_intent_v1(uuid,text,uuid,jsonb,uuid) TO authenticated;
COMMIT;
