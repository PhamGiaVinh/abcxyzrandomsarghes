-- Forward-only opt-in receipt boundary. Does not migrate/replay legacy requests.
-- Recovery: revoke this endpoint; retain all receipt/tombstone rows and audit.
BEGIN;
DO $$ DECLARE v record; BEGIN
 FOR v IN SELECT * FROM (VALUES
  ('public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)','e9902eafee8dd7e62d297a941424b90a'),
  ('public.chip_ops_unseal_bag(uuid)','f55f596e246c5cbbf95cc106850bb4d3'),
  ('public.chip_ops_close_day(uuid,integer,integer,boolean,text)','25c71d3ae0de17f2521627e5fe62d45b'),
  ('public.chip_ops_reopen_day(uuid,integer,integer)','b60423e1a95e02384ad4ff504bd3d68f')
 ) x(signature,digest) LOOP
  IF to_regprocedure(v.signature) IS NULL OR md5(replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),'')) IS DISTINCT FROM v.digest THEN
   RAISE EXCEPTION 'bag_intent_dependency_drift: %',v.signature;
  END IF;
 END LOOP;
 IF to_regclass('floor_private.chip_mutation_receipts') IS NULL THEN RAISE EXCEPTION 'chip_receipts_missing'; END IF;
END $$;
CREATE FUNCTION public.chip_ops_bag_intent_v1(
 p_tournament_id uuid,p_day_number integer,p_operation text,p_payload jsonb,
 p_request_id uuid,p_expected_actor uuid,p_action text DEFAULT 'write')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; canonical jsonb; fingerprint jsonb;
 prior floor_private.chip_mutation_receipts%ROWTYPE; result jsonb;
 player uuid; bag uuid; total bigint; old_version integer; seal boolean; force_signoff boolean;
 code text; reason text;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor THEN
  RETURN jsonb_build_object('error','ACTOR_MISMATCH');
 END IF;
 IF p_tournament_id IS NULL OR p_day_number IS NULL OR p_day_number<1 OR p_request_id IS NULL
  OR p_operation IS NULL OR p_operation NOT IN ('record','unseal','close','reopen')
  OR p_action IS NULL OR p_action NOT IN ('write','read','cancel')
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
  RETURN jsonb_build_object('error','INVALID_INPUT');
 END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
 IF NOT (COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN
  RETURN jsonb_build_object('error','Forbidden');
 END IF;
 -- Exact keys and JSON types: fingerprints never silently coerce a different intent.
 IF p_operation='record' THEN
  player:=(p_payload->>'player_id')::uuid; code:=p_payload->>'bag_code';
  IF jsonb_typeof(p_payload->'seal') IS DISTINCT FROM 'boolean'
   OR (p_payload->'total_value' IS DISTINCT FROM 'null'::jsonb AND
    (jsonb_typeof(p_payload->'total_value') IS DISTINCT FROM 'number' OR (p_payload->>'total_value') !~ '^[0-9]+$')) THEN
   RETURN jsonb_build_object('error','INVALID_INPUT');
  END IF;
  total:=(p_payload->>'total_value')::bigint; seal:=(p_payload->>'seal')::boolean;
  canonical:=jsonb_build_object('player_id',player,'bag_code',code,'total_value',total,'seal',seal);
  IF player IS NULL OR total<0 OR total>9007199254740991 OR length(code)>128 THEN
   RETURN jsonb_build_object('error','INVALID_INPUT');
  END IF;
 ELSIF p_operation='unseal' THEN
  bag:=(p_payload->>'bag_id')::uuid; canonical:=jsonb_build_object('bag_id',bag);
  IF bag IS NULL THEN RETURN jsonb_build_object('error','INVALID_INPUT'); END IF;
 ELSE
  IF jsonb_typeof(p_payload->'old_version') IS DISTINCT FROM 'number' OR (p_payload->>'old_version') !~ '^[0-9]+$' THEN
   RETURN jsonb_build_object('error','INVALID_INPUT');
  END IF;
  old_version:=(p_payload->>'old_version')::integer;
  canonical:=jsonb_build_object('old_version',old_version);
  IF p_operation='close' THEN
   IF jsonb_typeof(p_payload->'force_signoff') IS DISTINCT FROM 'boolean' THEN RETURN jsonb_build_object('error','INVALID_INPUT'); END IF;
   force_signoff:=(p_payload->>'force_signoff')::boolean; reason:=p_payload->>'signoff_reason';
   canonical:=canonical||jsonb_build_object('force_signoff',force_signoff,'signoff_reason',reason);
  END IF;
 END IF;
 IF canonical IS DISTINCT FROM p_payload THEN RETURN jsonb_build_object('error','INVALID_INPUT'); END IF;
 fingerprint:=jsonb_build_object('tournament_id',p_tournament_id,'day_number',p_day_number,'operation',p_operation,'payload',canonical);
 IF p_action<>'read' THEN
  -- Same club -> tournament -> key order and key namespace as existing chip receipts.
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||club::text));
  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.club_id=club AND t.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext(p_request_id::text));
  IF NOT (COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN
   RETURN jsonb_build_object('error','Forbidden');
  END IF;
 END IF;
 SELECT * INTO prior FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=actor AND r.request_key=p_request_id::text;
 IF FOUND THEN
  IF prior.operation IS DISTINCT FROM 'bag_tag_v1' OR prior.payload IS DISTINCT FROM fingerprint THEN
   RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN jsonb_build_object('status','committed','actor_id',actor,'request_id',p_request_id,'intent',fingerprint,'result',prior.result);
 END IF;
 IF p_action='read' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_action='cancel' THEN
  result:=jsonb_build_object('status','cancelled','error','REQUEST_CANCELLED');
 ELSE
  IF p_operation='record' THEN
   result:=public.chip_ops_record_bag(p_tournament_id,p_day_number,player,code,total,seal);
  ELSIF p_operation='unseal' THEN
   IF NOT EXISTS(SELECT 1 FROM public.chip_bag b WHERE b.id=bag AND b.tournament_id=p_tournament_id AND b.day_number=p_day_number) THEN
    result:=jsonb_build_object('error','BAG_NOT_IN_DAY');
   ELSE result:=public.chip_ops_unseal_bag(bag); END IF;
  ELSIF p_operation='close' THEN
   result:=public.chip_ops_close_day(p_tournament_id,p_day_number,old_version,force_signoff,reason);
  ELSE result:=public.chip_ops_reopen_day(p_tournament_id,p_day_number,old_version); END IF;
 END IF;
 -- Business rejection is terminal for this exact key too; retry needs a fresh intent.
 INSERT INTO floor_private.chip_mutation_receipts(actor_id,request_key,operation,payload,result)
 VALUES(actor,p_request_id::text,'bag_tag_v1',fingerprint,result);
 RETURN jsonb_build_object('status','committed','actor_id',actor,'request_id',p_request_id,'intent',fingerprint,'result',result);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('error','INVALID_INPUT');
END $$;
ALTER FUNCTION public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text) TO authenticated;
COMMIT;
