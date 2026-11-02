-- Forward298: preserve Ops upcoming/level1 without changing old canonical defaults.
-- Existing function/actor checks/ownership/ACL only; no Auth/RLS/grant changes.
-- LOCAL candidate; no production apply authorized.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $compat298$
DECLARE target oid:='public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid)'::regprocedure;
 original_acl aclitem[]; original_owner oid;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'e0138e0be86fc4cfdaf325a216a415b7' THEN
  RAISE EXCEPTION 'create298_precondition_drift';
 END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.ops_create_tournament(uuid,text,timestamptz,integer,integer,integer,integer,text)'::regprocedure) IS DISTINCT FROM '2f258fa143ac8744e026b95900f29799' THEN
  RAISE EXCEPTION 'create298_legacy_lifecycle_drift';
 END IF;
 SELECT proacl,proowner INTO original_acl,original_owner FROM pg_proc WHERE oid=target;
 EXECUTE $definition298$CREATE OR REPLACE FUNCTION public.create_tournament_with_levels_v1(p_club_id uuid, p_config jsonb, p_levels jsonb, p_request_id uuid, p_expected_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid:=auth.uid(); config public.tournaments%ROWTYPE;
  created public.tournaments%ROWTYPE; receipt record; fingerprint text; result jsonb;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_changed');
  END IF;
  -- Same authority as tournaments INSERT, not the broader Floor helper.
  IF (public.is_club_dealer_control(actor,p_club_id)
    OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF p_club_id IS NULL OR p_request_id IS NULL
    OR pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p_levels) IS DISTINCT FROM 'array' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_request');
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_config) k WHERE k NOT IN
    ('name','start_time','buy_in','rake_amount','service_fee_amount','guarantee_amount',
     'starting_stack','location','description','game_type','minutes_per_level',
     'late_reg_close_level','operations_mode','status','current_level')) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','unsupported_create_field');
  END IF;
  IF pg_catalog.jsonb_array_length(p_levels)>0 AND NOT EXISTS(
    SELECT 1 FROM public.clubs c WHERE c.id=p_club_id AND
      (c.owner_id=actor
       OR EXISTS(SELECT 1 FROM public.club_cashiers x WHERE x.club_id=c.id AND x.user_id=actor)
       OR EXISTS(SELECT 1 FROM public.club_trackers x WHERE x.club_id=c.id AND x.user_id=actor)
       OR EXISTS(SELECT 1 FROM public.club_dealer_controls x WHERE x.club_id=c.id AND x.user_id=actor))
  ) THEN
    -- Preserve the existing levels write-policy intersection as well.
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','blind_levels_not_allowed');
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_levels) x
    WHERE pg_catalog.jsonb_typeof(x) IS DISTINCT FROM 'object') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_blind_levels');
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_levels) x,
      LATERAL pg_catalog.jsonb_object_keys(x) k WHERE k NOT IN
      ('level_number','small_blind','big_blind','ante','duration_minutes','is_break')) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','unsupported_blind_field');
  END IF;
  -- Optional compatibility pair for the existing Ops creation lifecycle only.
  IF p_config ? 'status' OR p_config ? 'current_level' THEN
    IF p_config->'status' IS DISTINCT FROM '"upcoming"'::jsonb
      OR pg_catalog.jsonb_typeof(p_config->'current_level') IS DISTINCT FROM 'number'
      OR (p_config->'current_level')::text IS DISTINCT FROM '1'
    THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_initial_lifecycle'); END IF;
  END IF;
  SELECT * INTO config FROM pg_catalog.jsonb_populate_record(NULL::public.tournaments,p_config);
  IF NULLIF(pg_catalog.btrim(config.name),'') IS NULL OR config.start_time IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','required_create_fields_missing');
  END IF;
  fingerprint:=pg_catalog.jsonb_build_object('club_id',p_club_id,'config',p_config,'levels',p_levels)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(actor,'create_tournament_with_levels_v1',p_request_id);
  SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_with_levels_v1',p_request_id);
  IF FOUND THEN
    IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN receipt.result;
  END IF;

  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_config) AS field(key,value)
    WHERE field.key IN('buy_in','rake_amount','service_fee_amount','guarantee_amount')
      AND field.value<>'null'::jsonb AND
      CASE WHEN pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'number' THEN true
      ELSE (field.value::text)::numeric<0 OR (field.value::text)::numeric>9007199254740991
        OR (field.value::text)::numeric<>pg_catalog.trunc((field.value::text)::numeric) END)
  THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_money'); END IF;
  IF p_config ? 'status' THEN
  INSERT INTO public.tournaments(club_id,name,start_time,buy_in,rake_amount,
    service_fee_amount,guarantee_amount,starting_stack,location,description,game_type,
    minutes_per_level,late_reg_close_level,operations_mode,live_status,status,current_level)
  VALUES(p_club_id,config.name,config.start_time,config.buy_in,config.rake_amount,
    COALESCE(config.service_fee_amount,0),config.guarantee_amount,config.starting_stack,
    config.location,config.description,config.game_type,config.minutes_per_level,
    config.late_reg_close_level,COALESCE(config.operations_mode,'standard'),'registering','upcoming',1)
  RETURNING * INTO created;
  ELSE
  INSERT INTO public.tournaments(club_id,name,start_time,buy_in,rake_amount,
    service_fee_amount,guarantee_amount,starting_stack,location,description,game_type,
    minutes_per_level,late_reg_close_level,operations_mode,live_status)
  VALUES(p_club_id,config.name,config.start_time,config.buy_in,config.rake_amount,
    COALESCE(config.service_fee_amount,0),config.guarantee_amount,config.starting_stack,
    config.location,config.description,config.game_type,config.minutes_per_level,
    config.late_reg_close_level,COALESCE(config.operations_mode,'standard'),'registering')
  RETURNING * INTO created;
  END IF;
  INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,
    ante,duration_minutes,is_break)
  SELECT created.id,l.level_number,l.small_blind,l.big_blind,l.ante,l.duration_minutes,l.is_break
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.tournament_levels,p_levels) l;
  result:=pg_catalog.jsonb_build_object('ok',true,'tournament_id',created.id,
    'club_id',p_club_id,'actor_id',actor,'request_id',p_request_id,
    'level_count',pg_catalog.jsonb_array_length(p_levels));
  PERFORM floor_private.floor_table_v3_save_receipt(actor,'create_tournament_with_levels_v1',p_request_id,fingerprint,result);
  RETURN result;
END;
$function$
$definition298$;
 IF EXISTS(SELECT FROM pg_proc WHERE oid=target AND (proacl IS DISTINCT FROM original_acl OR proowner IS DISTINCT FROM original_owner)) THEN
  RAISE EXCEPTION 'create298_authority_metadata_changed';
 END IF;
END $compat298$;
COMMIT;
