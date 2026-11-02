-- CLI scaffold20261020102758; reserved210 against source/isolated catalog.
-- Owner: one GTD for the whole Main Event, never one per flight.
-- GTD is a commitment, NOT funded overlay/cash. No financial ledger is written.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $dependency$
BEGIN
 IF current_user<>'postgres' OR md5(replace(pg_get_functiondef(
  'public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure),chr(13),''))
  <>'faa91686f9829c3d49ebfb3ed23a749b' THEN RAISE EXCEPTION 'main_event210_dependency_drift'; END IF;
END $dependency$;
ALTER TABLE public.tournament_events ADD COLUMN guarantee_amount numeric;
ALTER TABLE public.tournament_events ADD CONSTRAINT tournament_events_guarantee_amount_v1_check
 CHECK(guarantee_amount IS NULL OR (guarantee_amount>=0 AND guarantee_amount<=9007199254740991
 AND guarantee_amount=pg_catalog.trunc(guarantee_amount)));
COMMENT ON COLUMN public.tournament_events.guarantee_amount IS
 'One whole-event GTD commitment; NULL unreported, zero no guarantee. Not funded money; never copied to flights.';

CREATE FUNCTION private.guard_main_event_guarantee210() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF NEW.guarantee_amount IS DISTINCT FROM OLD.guarantee_amount AND (
  EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r WHERE r.event_id=OLD.id)
  OR EXISTS(SELECT 1 FROM public.tournaments t JOIN public.tournament_registrations r ON r.tournament_id=t.id WHERE t.event_id=OLD.id)
  OR EXISTS(SELECT 1 FROM public.tournaments t WHERE t.event_id=OLD.id AND t.live_status IS DISTINCT FROM 'registering')) THEN
  RAISE EXCEPTION 'main_event_guarantee_frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $function$;
ALTER FUNCTION private.guard_main_event_guarantee210() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_main_event_guarantee210() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER main_event_guarantee_frozen210 BEFORE UPDATE OF guarantee_amount ON public.tournament_events
 FOR EACH ROW EXECUTE FUNCTION private.guard_main_event_guarantee210();

-- The older registration fence is flag-gated. A GTD edit must also serialize
-- with the first entry while that rollout flag is OFF.
CREATE FUNCTION private.lock_main_event_registration210() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 PERFORM 1 FROM public.tournament_events e JOIN public.tournaments t ON t.event_id=e.id
 WHERE t.id=NEW.tournament_id FOR SHARE OF e;
 RETURN NEW;
END $function$;
ALTER FUNCTION private.lock_main_event_registration210() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lock_main_event_registration210() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER main_event_registration_parent210 BEFORE INSERT OR UPDATE OF tournament_id ON public.tournament_registrations
 FOR EACH ROW EXECUTE FUNCTION private.lock_main_event_registration210();

DO $patch$
DECLARE
 target regprocedure:='public.create_tournament_event_with_flights_v2(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
 before_row record;after_row record;definition text;patched text;
 allowlist text:='''minutes_per_level'',''late_reg_close_level'',''flight_count'',''final_start_time'',''flight_start_times''))';
 validation_anchor text:=' fingerprint:=pg_catalog.jsonb_build_object(';
 receipt_anchor text:=' result:=result||pg_catalog.jsonb_build_object(';
 validation text:=$validation$
 IF p_config?'service_fee_amount' AND (pg_catalog.jsonb_typeof(p_config->'service_fee_amount') IS DISTINCT FROM 'number'
  OR (p_config->>'service_fee_amount')::numeric<0
  OR (p_config->>'service_fee_amount')::numeric>9007199254740991
  OR (p_config->>'service_fee_amount')::numeric<>pg_catalog.trunc((p_config->>'service_fee_amount')::numeric)) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_fee');
 END IF;
 IF p_config?'guarantee_amount' AND p_config->'guarantee_amount'<>'null'::jsonb AND (
  pg_catalog.jsonb_typeof(p_config->'guarantee_amount') IS DISTINCT FROM 'number'
  OR (p_config->>'guarantee_amount')::numeric<0
  OR (p_config->>'guarantee_amount')::numeric>9007199254740991
  OR (p_config->>'guarantee_amount')::numeric<>pg_catalog.trunc((p_config->>'guarantee_amount')::numeric)) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_guarantee');
 END IF;
 IF (p_config?'location' AND pg_catalog.jsonb_typeof(p_config->'location') NOT IN ('string','null'))
 OR (p_config?'description' AND pg_catalog.jsonb_typeof(p_config->'description') NOT IN ('string','null')) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_metadata');
 END IF;
$validation$;
 save_config text:=$save_config$
 -- Only children created by this transaction; old receipts returned before this point.
 IF p_config?'guarantee_amount' THEN
  UPDATE public.tournament_events SET guarantee_amount=(p_config->>'guarantee_amount')::numeric
  WHERE id=(result->>'event_id')::uuid AND club_id=p_club_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'main_event210_parent_missing'; END IF;
 END IF;
 IF p_config ?| ARRAY['service_fee_amount','location','description'] THEN
  UPDATE public.tournaments SET
   service_fee_amount=CASE WHEN p_config?'service_fee_amount' THEN (p_config->>'service_fee_amount')::bigint ELSE service_fee_amount END,
   location=CASE WHEN p_config?'location' THEN p_config->>'location' ELSE location END,
   description=CASE WHEN p_config?'description' THEN p_config->>'description' ELSE description END
  WHERE event_id=(result->>'event_id')::uuid AND club_id=p_club_id AND live_status='registering';
  IF (SELECT count(*) FROM public.tournaments WHERE event_id=(result->>'event_id')::uuid AND club_id=p_club_id
   AND live_status='registering')<>(p_config->>'flight_count')::integer+1 THEN
   RAISE EXCEPTION 'main_event210_child_scope_changed';
  END IF;
 END IF;
$save_config$;
BEGIN
 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') AS definition INTO STRICT before_row FROM pg_proc p WHERE oid=target;
 definition:=before_row.definition;
 IF cardinality(string_to_array(definition,allowlist))<>2 OR cardinality(string_to_array(definition,validation_anchor))<>2
 OR cardinality(string_to_array(definition,receipt_anchor))<>2 THEN RAISE EXCEPTION 'main_event210_anchor_drift'; END IF;
 patched:=replace(replace(replace(definition,allowlist,
  '''minutes_per_level'',''late_reg_close_level'',''flight_count'',''final_start_time'',''flight_start_times'',''service_fee_amount'',''location'',''description'',''guarantee_amount''))'),
  validation_anchor,validation||validation_anchor),receipt_anchor,save_config||receipt_anchor);
 EXECUTE patched;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=target;
 IF before_row.proacl IS DISTINCT FROM after_row.proacl OR before_row.proowner<>after_row.proowner
 OR before_row.proconfig IS DISTINCT FROM after_row.proconfig OR before_row.prosecdef IS DISTINCT FROM after_row.prosecdef THEN
  RAISE EXCEPTION 'main_event210_unexpected_metadata_change';
 END IF;
END $patch$;
COMMIT;
