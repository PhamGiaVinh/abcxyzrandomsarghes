-- CLI-created forward candidate91. Parent and selected levels commit together.
-- Preserves the existing INSERT authority, money values and registering status.
-- Recovery: restore compatible frontend; forward-revoke this new RPC if needed.
-- Do not delete a created tournament/receipt to compensate an unknown response.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE FUNCTION public.create_tournament_with_levels_v1(
  p_club_id uuid, p_config jsonb, p_levels jsonb,
  p_request_id uuid, p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
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
     'late_reg_close_level','operations_mode')) THEN
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
  INSERT INTO public.tournaments(club_id,name,start_time,buy_in,rake_amount,
    service_fee_amount,guarantee_amount,starting_stack,location,description,game_type,
    minutes_per_level,late_reg_close_level,operations_mode,live_status)
  VALUES(p_club_id,config.name,config.start_time,config.buy_in,config.rake_amount,
    COALESCE(config.service_fee_amount,0),config.guarantee_amount,config.starting_stack,
    config.location,config.description,config.game_type,config.minutes_per_level,
    config.late_reg_close_level,COALESCE(config.operations_mode,'standard'),'registering')
  RETURNING * INTO created;
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
$function$;
REVOKE ALL ON FUNCTION public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_tournament_with_levels_v1(uuid,jsonb,jsonb,uuid,uuid) TO authenticated;

CREATE FUNCTION public.get_tournament_create_receipt_v1(
  p_club_id uuid, p_config jsonb, p_levels jsonb,
  p_request_id uuid, p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE actor uuid:=auth.uid(); receipt record; fingerprint text;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_changed');
  END IF;
  IF (public.is_club_dealer_control(actor,p_club_id)
    OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  fingerprint:=pg_catalog.jsonb_build_object('club_id',p_club_id,'config',p_config,'levels',p_levels)::text;
  SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'create_tournament_with_levels_v1',p_request_id);
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','receipt_not_found'); END IF;
  IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;
  RETURN receipt.result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_tournament_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_create_receipt_v1(uuid,jsonb,jsonb,uuid,uuid) TO authenticated;
COMMIT;
