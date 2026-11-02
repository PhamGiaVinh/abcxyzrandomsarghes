-- CLI scaffold20261020100833; reserved209 against source/local catalog.
-- Reuse the atomic Main Event writer208 and the existing actor/request receipt store.
-- New clients never retry the unkeyed legacy writer. Legacy ACL is not expanded.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $dependency$
BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public.create_tournament_event_with_flights(uuid,text,numeric,integer,integer,integer,text,integer,integer,integer,timestamptz,jsonb,jsonb)'::regprocedure),chr(13),''))
  <>'969e2d62b1baac5e22d510d96e78f0eb' THEN RAISE EXCEPTION 'main_event209_dependency_drift'; END IF;
END $dependency$;

CREATE FUNCTION public.create_tournament_event_with_flights_v2(
 p_club_id uuid,p_config jsonb,p_levels jsonb,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; fingerprint text; result jsonb; club_owner uuid;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_changed');
 END IF;
 IF p_club_id IS NULL OR p_request_id IS NULL
 OR pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object'
 OR pg_catalog.jsonb_typeof(p_levels) IS DISTINCT FROM 'array' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_request');
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_config) k WHERE k NOT IN
  ('name','itm_percent','buy_in','rake_amount','starting_stack','game_type',
   'minutes_per_level','late_reg_close_level','flight_count','final_start_time','flight_start_times')) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','unsupported_create_field');
 END IF;
 fingerprint:=pg_catalog.jsonb_build_object('club_id',p_club_id,'config',p_config,'levels',p_levels)::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'create_tournament_event_with_flights_v2',p_request_id);
 -- Resolve current authority after waiting for another writer; hold owner row through commit.
 SELECT c.owner_id INTO club_owner FROM public.clubs c WHERE c.id=p_club_id FOR SHARE;
 IF (club_owner=actor OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_event_with_flights_v2',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN receipt.result;
 END IF;
 IF NULLIF(pg_catalog.btrim(p_config->>'name'),'') IS NULL OR p_config->>'final_start_time' IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','required_create_fields_missing');
 END IF;
 IF p_config->'flight_start_times' IS NOT NULL AND p_config->'flight_start_times'<>'null'::jsonb
 AND pg_catalog.jsonb_typeof(p_config->'flight_start_times')<>'array' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_flight_start_times');
 END IF;
 result:=public.create_tournament_event_with_flights(
  p_club_id,p_config->>'name',(p_config->>'itm_percent')::numeric,
  (p_config->>'buy_in')::integer,(p_config->>'rake_amount')::integer,
  (p_config->>'starting_stack')::integer,p_config->>'game_type',
  (p_config->>'minutes_per_level')::integer,(p_config->>'late_reg_close_level')::integer,
  (p_config->>'flight_count')::integer,(p_config->>'final_start_time')::timestamptz,
  NULLIF(p_config->'flight_start_times','null'::jsonb),p_levels);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 result:=result||pg_catalog.jsonb_build_object('actor_id',actor,'club_id',p_club_id,
  'request_id',p_request_id,'level_count',pg_catalog.jsonb_array_length(p_levels));
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'create_tournament_event_with_flights_v2',p_request_id,fingerprint,result);
 RETURN result;
END $function$;
ALTER FUNCTION public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid) TO authenticated;

CREATE FUNCTION public.get_tournament_event_create_receipt_v1(
 p_club_id uuid,p_config jsonb,p_levels jsonb,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; fingerprint text;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_changed');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=p_club_id
  AND (c.owner_id=actor OR public.has_role(actor,'super_admin'::public.app_role))) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 IF p_request_id IS NULL OR pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object'
 OR pg_catalog.jsonb_typeof(p_levels) IS DISTINCT FROM 'array' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_request');
 END IF;
 fingerprint:=pg_catalog.jsonb_build_object('club_id',p_club_id,'config',p_config,'levels',p_levels)::text;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_event_with_flights_v2',p_request_id);
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','receipt_not_found'); END IF;
 IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
 END IF;
 RETURN receipt.result;
END $function$;
ALTER FUNCTION public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_event_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid) TO authenticated;
COMMIT;
