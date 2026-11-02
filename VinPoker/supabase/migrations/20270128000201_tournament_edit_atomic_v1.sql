-- Forward local candidate201. Existing snapshot prices/entries are not rewritten.
-- Recovery: compatible frontend + exact actor/request receipt; never delete audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid)') IS NOT NULL
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.tournaments'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.tournament_levels'::regclass)
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.tournament_levels'::regclass
      AND tgname IN('spectator_v2_levels_ranking_dirty','spectator_v2_levels_tables_dirty') AND tgenabled='O')<>2
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid='spectator_projection_v2.entity_markers'::regclass AND confrelid='public.tournaments'::regclass)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid='spectator_projection_v2.work_groups'::regclass AND confrelid='public.tournaments'::regclass)
 THEN RAISE EXCEPTION 'tournament_edit201_catalog_precondition';END IF;
END $$;

CREATE FUNCTION floor_private.tournament_edit_snapshot_v1(p_tournament_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('config',jsonb_build_object(
  'name',t.name,'start_time',t.start_time,'buy_in',t.buy_in,'rake_amount',t.rake_amount,
  'service_fee_amount',t.service_fee_amount,'guarantee_amount',t.guarantee_amount,'starting_stack',t.starting_stack,
  'location',t.location,'description',t.description,'game_type',t.game_type,
  'minutes_per_level',t.minutes_per_level,'late_reg_close_level',t.late_reg_close_level),
  'levels',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.level_number,l.id) FROM public.tournament_levels l WHERE l.tournament_id=t.id),'[]'::jsonb),
  'lifecycle',jsonb_build_object('club_id',t.club_id,'status',t.status,'live_status',t.live_status,'deleted_at',t.deleted_at,
   'operations_mode',t.operations_mode,'event_id',t.event_id,'phase',t.phase,'current_level',t.current_level,
   'current_level_id',t.current_level_id,'clock_control_revision',t.clock_control_revision,'updated_at',t.updated_at))
 FROM public.tournaments t WHERE t.id=p_tournament_id;
$$;
REVOKE ALL ON FUNCTION floor_private.tournament_edit_snapshot_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_tournament_edit_context_v1(p_tournament_id uuid,p_expected_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();t public.tournaments%ROWTYPE;can_blinds boolean;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN RETURN jsonb_build_object('ok',false,'error','actor_changed');END IF;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND deleted_at IS NULL;
 IF NOT FOUND OR (public.is_club_dealer_control(actor,t.club_id) OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 SELECT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=t.club_id AND
  (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers x WHERE x.club_id=c.id AND x.user_id=actor)
   OR EXISTS(SELECT 1 FROM public.club_trackers x WHERE x.club_id=c.id AND x.user_id=actor)
   OR EXISTS(SELECT 1 FROM public.club_dealer_controls x WHERE x.club_id=c.id AND x.user_id=actor))) INTO can_blinds;
 RETURN jsonb_build_object('ok',true,'tournament_id',t.id,'club_id',t.club_id,'actor_id',actor,
  'can_edit_blinds',can_blinds,'state',floor_private.tournament_edit_snapshot_v1(t.id));
END $$;

CREATE FUNCTION public.edit_tournament_with_levels_v1(
 p_tournament_id uuid,p_club_id uuid,p_expected_state jsonb,p_config jsonb,p_levels jsonb,
 p_request_id uuid,p_expected_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();t public.tournaments%ROWTYPE;c public.tournaments%ROWTYPE;
 receipt record;fingerprint text;result jsonb;before_state jsonb;k text;l jsonb;n bigint;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN RETURN jsonb_build_object('ok',false,'error','actor_changed');END IF;
 IF p_club_id IS NULL OR p_request_id IS NULL OR p_tournament_id IS NULL
 OR jsonb_typeof(p_expected_state) IS DISTINCT FROM 'object' OR jsonb_typeof(p_config) IS DISTINCT FROM 'object'
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_request');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_config) x WHERE x NOT IN
  ('name','start_time','buy_in','rake_amount','service_fee_amount','guarantee_amount','starting_stack','location','description','game_type','minutes_per_level','late_reg_close_level'))
 OR NOT (p_config ?& ARRAY['name','start_time','buy_in','rake_amount','service_fee_amount','guarantee_amount','starting_stack','location','description','game_type','minutes_per_level','late_reg_close_level'])
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_fields');END IF;
 FOREACH k IN ARRAY ARRAY['name','start_time','game_type'] LOOP
  IF jsonb_typeof(p_config->k) IS DISTINCT FROM 'string' OR nullif(btrim(p_config->>k),'') IS NULL
  THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_fields');END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['location','description'] LOOP
  IF jsonb_typeof(p_config->k) NOT IN('string','null') THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_fields');END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['buy_in','rake_amount','service_fee_amount','starting_stack','minutes_per_level','late_reg_close_level','guarantee_amount'] LOOP
  IF k='guarantee_amount' AND p_config->k='null'::jsonb THEN CONTINUE;END IF;
  IF jsonb_typeof(p_config->k) IS DISTINCT FROM 'number' THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_number');END IF;
  IF (p_config->>k)::numeric<0 OR trunc((p_config->>k)::numeric)<>(p_config->>k)::numeric
  THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_number');END IF;
 END LOOP;
 SELECT * INTO c FROM jsonb_populate_record(NULL::public.tournaments,p_config);
 IF c.starting_stack<=0 OR c.minutes_per_level<=0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_edit_number');END IF;
 IF p_levels IS NOT NULL THEN
  IF jsonb_typeof(p_levels) IS DISTINCT FROM 'array' OR jsonb_array_length(p_levels)=0
  THEN RETURN jsonb_build_object('ok',false,'error','invalid_blind_levels');END IF;
  n:=0;
  FOR l IN SELECT value FROM jsonb_array_elements(p_levels) LOOP
   n:=n+1;
   IF jsonb_typeof(l) IS DISTINCT FROM 'object' OR NOT(l ?& ARRAY['level_number','small_blind','big_blind','ante','duration_minutes','is_break'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(l) x WHERE x NOT IN('level_number','small_blind','big_blind','ante','duration_minutes','is_break'))
    OR jsonb_typeof(l->'is_break') IS DISTINCT FROM 'boolean'
   THEN RETURN jsonb_build_object('ok',false,'error','invalid_blind_levels');END IF;
   FOREACH k IN ARRAY ARRAY['level_number','small_blind','big_blind','ante','duration_minutes'] LOOP
    IF jsonb_typeof(l->k) IS DISTINCT FROM 'number' THEN RETURN jsonb_build_object('ok',false,'error','invalid_blind_levels');END IF;
    IF (l->>k)::numeric<0 OR trunc((l->>k)::numeric)<>(l->>k)::numeric
    THEN RETURN jsonb_build_object('ok',false,'error','invalid_blind_levels');END IF;
   END LOOP;
   IF (l->>'level_number')::bigint<>n OR (l->>'duration_minutes')::numeric<=0
    OR ((l->>'is_break')::boolean=false AND (l->>'big_blind')::numeric<=0)
   THEN RETURN jsonb_build_object('ok',false,'error','invalid_blind_levels');END IF;
  END LOOP;
 END IF;
 -- Check authority before private receipt lookup or mutation locking.
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND club_id=p_club_id AND deleted_at IS NULL;
 IF NOT FOUND OR (public.is_club_dealer_control(actor,p_club_id) OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 IF p_levels IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clubs cl WHERE cl.id=p_club_id AND
  (cl.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers x WHERE x.club_id=cl.id AND x.user_id=actor)
   OR EXISTS(SELECT 1 FROM public.club_trackers x WHERE x.club_id=cl.id AND x.user_id=actor)
   OR EXISTS(SELECT 1 FROM public.club_dealer_controls x WHERE x.club_id=cl.id AND x.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','blind_levels_not_allowed');END IF;
 fingerprint:=jsonb_build_object('tournament_id',p_tournament_id,'club_id',p_club_id,'expected_state',p_expected_state,'config',p_config,'levels',p_levels)::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'edit_tournament_with_levels_v1',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'edit_tournament_with_levels_v1',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');END IF;
  RETURN receipt.result;
 END IF;
 -- Strong lock is deliberate: existing projection FK writes participate in it.
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id AND club_id=p_club_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_found');END IF;
 IF (public.is_club_dealer_control(actor,p_club_id) OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 IF p_levels IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clubs cl WHERE cl.id=p_club_id AND
  (cl.owner_id=actor OR EXISTS(SELECT 1 FROM public.club_cashiers x WHERE x.club_id=cl.id AND x.user_id=actor)
   OR EXISTS(SELECT 1 FROM public.club_trackers x WHERE x.club_id=cl.id AND x.user_id=actor)
   OR EXISTS(SELECT 1 FROM public.club_dealer_controls x WHERE x.club_id=cl.id AND x.user_id=actor)))
 THEN RETURN jsonb_build_object('ok',false,'error','blind_levels_not_allowed');END IF;
 IF t.status IN('completed','cancelled') THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_open');END IF;
 before_state:=floor_private.tournament_edit_snapshot_v1(t.id);
 IF before_state IS DISTINCT FROM p_expected_state THEN RETURN jsonb_build_object('ok',false,'error','stale_edit_context');END IF;
 UPDATE public.tournaments SET name=btrim(c.name),start_time=c.start_time,buy_in=c.buy_in,rake_amount=c.rake_amount,
  service_fee_amount=c.service_fee_amount,guarantee_amount=c.guarantee_amount,starting_stack=c.starting_stack,
  location=c.location,description=c.description,game_type=c.game_type,minutes_per_level=c.minutes_per_level,
  late_reg_close_level=c.late_reg_close_level,updated_at=clock_timestamp() WHERE id=t.id;
 IF p_levels IS NOT NULL THEN
  DELETE FROM public.tournament_levels WHERE tournament_id=t.id;
  INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
  SELECT t.id,x.level_number,x.small_blind,x.big_blind,x.ante,x.duration_minutes,x.is_break
  FROM jsonb_populate_recordset(NULL::public.tournament_levels,p_levels) x;
 END IF;
 result:=jsonb_build_object('ok',true,'tournament_id',t.id,'club_id',p_club_id,'actor_id',actor,'request_id',p_request_id,
  'state',floor_private.tournament_edit_snapshot_v1(t.id));
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'edit_tournament_with_levels_v1',p_request_id,fingerprint,result);
 RETURN result;
END $$;

CREATE FUNCTION public.get_tournament_edit_receipt_v1(
 p_tournament_id uuid,p_club_id uuid,p_expected_state jsonb,p_config jsonb,p_levels jsonb,
 p_request_id uuid,p_expected_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();r record;fingerprint text;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_actor_id THEN RETURN jsonb_build_object('ok',false,'error','actor_changed');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.club_id=p_club_id)
 OR (public.is_club_dealer_control(actor,p_club_id) OR public.has_role(actor,'super_admin'::public.app_role)) IS NOT TRUE
 THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');END IF;
 fingerprint:=jsonb_build_object('tournament_id',p_tournament_id,'club_id',p_club_id,'expected_state',p_expected_state,'config',p_config,'levels',p_levels)::text;
 SELECT * INTO r FROM floor_private.floor_table_v3_existing_receipt(actor,'edit_tournament_with_levels_v1',p_request_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','receipt_not_found');END IF;
 IF r.request_fingerprint IS DISTINCT FROM fingerprint THEN RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');END IF;
 RETURN r.result;
END $$;
REVOKE ALL ON FUNCTION public.get_tournament_edit_context_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_tournament_edit_receipt_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_edit_context_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_tournament_with_levels_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_edit_receipt_v1(uuid,uuid,jsonb,jsonb,jsonb,uuid,uuid) TO authenticated;
COMMIT;
