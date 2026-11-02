-- CLI-created forward candidate; local catalog slot137 checked before qualification.
-- Scheduling intentionally has no levels. Existing clock readiness guards remain.
-- Rollback: revoke these two new endpoints; retain tournaments and receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='tournaments' AND column_name='rake_amount') IS DISTINCT FROM '0'
 OR (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='tournaments' AND column_name='minutes_per_level') IS DISTINCT FROM '20'
 OR (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='tournaments' AND column_name='late_reg_close_level') IS DISTINCT FROM '6' THEN
  RAISE EXCEPTION 'schedule default catalog drift';
 END IF;
END $$;

CREATE FUNCTION public.create_tournament_schedule_batch_v1(
 p_rows jsonb,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; fingerprint text; row jsonb;
 child jsonb; created jsonb:='[]'; result jsonb; ordinal integer:=0; rejection text;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
  RETURN jsonb_build_object('ok',false,'error','actor_changed'); END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_schedule_batch'); END IF;
 IF jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>100 THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_schedule_batch'); END IF;
 -- Same keys and authority as existing scheduling callers. Never accept status,
 -- official results, tables or policy changes through this endpoint.
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_schedule_row'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(row) k WHERE k NOT IN
   ('club_id','name','start_time','buy_in','starting_stack','game_type','location'))
   OR NOT row ?& ARRAY['club_id','name','start_time','buy_in','starting_stack','game_type']
   OR jsonb_typeof(row->'club_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(row->'name') IS DISTINCT FROM 'string' OR nullif(btrim(row->>'name'),'') IS NULL
   OR jsonb_typeof(row->'start_time') IS DISTINCT FROM 'string'
   OR jsonb_typeof(row->'buy_in') IS DISTINCT FROM 'number'
   OR jsonb_typeof(row->'starting_stack') IS DISTINCT FROM 'number'
   OR (row->>'buy_in')::numeric<0 OR trunc((row->>'buy_in')::numeric)<>(row->>'buy_in')::numeric
   OR (row->>'starting_stack')::numeric<=0 OR trunc((row->>'starting_stack')::numeric)<>(row->>'starting_stack')::numeric
   OR coalesce(row->>'game_type','') NOT IN ('nlh','plo','mixed')
   OR (row ? 'location' AND jsonb_typeof(row->'location') NOT IN ('string','null')) THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_schedule_row'); END IF;
  PERFORM (row->>'club_id')::uuid,(row->>'start_time')::timestamptz;
  IF (public.is_club_dealer_control(actor,(row->>'club_id')::uuid)
   OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE THEN
   RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
 END LOOP;
 fingerprint:=p_rows::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN receipt.result;
 END IF;
 -- This subtransaction guarantees a later child denial cannot leave earlier
 -- tournaments or child receipts committed as a partial batch.
 BEGIN
  FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   ordinal:=ordinal+1;
   child:=public.create_tournament_with_levels_v1((row->>'club_id')::uuid,
    (row-'club_id')||jsonb_build_object('rake_amount',0,'minutes_per_level',20,'late_reg_close_level',6),'[]'::jsonb,
    md5('schedule-batch-v1:'||p_request_id::text||':'||ordinal::text)::uuid,actor);
   IF child->>'ok' IS DISTINCT FROM 'true' THEN
    rejection:=coalesce(child->>'error','schedule_child_unconfirmed');
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_child_rejected';
   END IF;
   created:=created||jsonb_build_array(child);
  END LOOP;
  result:=jsonb_build_object('ok',true,'actor_id',actor,'request_id',p_request_id,
   'count',ordinal,'tournaments',created);
  PERFORM floor_private.floor_table_v3_save_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id,fingerprint,result);
 EXCEPTION WHEN raise_exception THEN
  RETURN jsonb_build_object('ok',false,'error',coalesce(rejection,'schedule_batch_rejected'));
 END;
 RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_tournament_schedule_batch_v1(jsonb,uuid,uuid) TO authenticated;

CREATE FUNCTION public.get_tournament_schedule_batch_receipt_v1(
 p_rows jsonb,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor uuid:=auth.uid(); receipt record;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
  RETURN jsonb_build_object('ok',false,'error','actor_changed'); END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_schedule_batch_v1',p_request_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','receipt_not_found'); END IF;
 IF receipt.request_fingerprint IS DISTINCT FROM p_rows::text THEN
  RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
 RETURN receipt.result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_tournament_schedule_batch_receipt_v1(jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_schedule_batch_receipt_v1(jsonb,uuid,uuid) TO authenticated;
COMMIT;
