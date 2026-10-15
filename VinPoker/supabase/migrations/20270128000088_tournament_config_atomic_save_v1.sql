-- CLI-created candidate; reserved88 after source/live collision check.
-- Atomic replacement for the legacy configuration form's separate mutations.
-- Explicitly selected new tables open through Floor; removed tables close
-- through Floor. No deletion/reparenting of table/seat/hand/entry history.
-- No money, blind levels, payout, rest policy or historical data changes.
-- Rollback: restore frontend artifact; revoke new RPCs in a reviewed forward
-- migration after request containment. Preserve sessions/history and receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE FUNCTION public.save_tournament_config_v1(
  p_tournament_id uuid, p_club_id uuid, p_config jsonb, p_table_ids uuid[],
  p_expected_updated_at timestamptz, p_expected_active_table_ids uuid[],
  p_request_id uuid, p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  actor uuid:=auth.uid(); tournament public.tournaments%ROWTYPE;
  desired uuid[]; expected uuid[]; current_ids uuid[]; current_physical uuid[];
  fingerprint text; receipt record; link record; physical uuid; result jsonb;
  nested_result jsonb; duration integer; warning integer; critical integer;
BEGIN
  IF actor IS DISTINCT FROM p_expected_actor_id OR actor IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_changed');
  END IF;
  IF actor IS NULL OR p_club_id IS NULL OR p_request_id IS NULL
    OR pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object'
    OR p_table_ids IS NULL OR p_expected_active_table_ids IS NULL
    OR pg_catalog.cardinality(p_table_ids)>50
    OR EXISTS(SELECT 1 FROM pg_catalog.unnest(p_table_ids) x WHERE x IS NULL)
    OR EXISTS(SELECT 1 FROM pg_catalog.unnest(p_expected_active_table_ids) x WHERE x IS NULL)
    OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_config) k
      WHERE k NOT IN ('name','description','swing_duration_minutes','warn_at_minutes','crit_at_minutes'))
    OR pg_catalog.jsonb_typeof(p_config->'name') IS DISTINCT FROM 'string'
    OR NULLIF(pg_catalog.btrim(p_config->>'name'),'') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_config_request');
  END IF;
  IF (floor_private.floor_table_v3_actor_is_tournament_operator(actor,p_club_id) IS TRUE
    OR public.is_club_dealer_control(actor,p_club_id) IS TRUE) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  duration:=(p_config->>'swing_duration_minutes')::integer;
  warning:=(p_config->>'warn_at_minutes')::integer;
  critical:=(p_config->>'crit_at_minutes')::integer;
  IF duration IS NULL OR duration<5 OR warning IS NULL OR warning<0
    OR critical IS NULL OR critical<0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_config_values');
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO desired
    FROM pg_catalog.unnest(p_table_ids) x;
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT x ORDER BY x),ARRAY[]::uuid[]) INTO expected
    FROM pg_catalog.unnest(p_expected_active_table_ids) x;
  IF pg_catalog.cardinality(desired)<>pg_catalog.cardinality(p_table_ids)
    OR pg_catalog.cardinality(expected)<>pg_catalog.cardinality(p_expected_active_table_ids) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','duplicate_table_identity');
  END IF;
  fingerprint:=pg_catalog.jsonb_build_object('tournament_id',p_tournament_id,'club_id',p_club_id,
    'config',p_config,'tables',desired,'expected_updated_at',p_expected_updated_at,
    'expected_active_table_ids',expected)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(actor,'save_tournament_config_v1',p_request_id);
  SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'save_tournament_config_v1',p_request_id);
  IF FOUND THEN
    IF receipt.request_fingerprint IS DISTINCT FROM fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN receipt.result;
  END IF;

  IF p_tournament_id IS NULL THEN
    IF p_expected_updated_at IS NOT NULL OR pg_catalog.cardinality(expected)<>0 THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_create_expectation');
    END IF;
    INSERT INTO public.tournaments(club_id,name,description,swing_duration_minutes,
      warn_at_minutes,crit_at_minutes,live_status)
    VALUES(p_club_id,pg_catalog.btrim(p_config->>'name'),p_config->>'description',
      duration,warning,critical,'registering') RETURNING * INTO tournament;
  ELSE
    SELECT * INTO tournament FROM public.tournaments t
      WHERE t.id=p_tournament_id AND t.club_id=p_club_id FOR UPDATE;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','tournament_not_found'); END IF;
    IF tournament.status IN ('completed','cancelled') OR tournament.deleted_at IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'error','tournament_not_open');
    END IF;
    IF p_expected_updated_at IS NULL OR tournament.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'error','STALE_CONFIG');
    END IF;
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(tt.id ORDER BY tt.id),ARRAY[]::uuid[]),
    COALESCE(pg_catalog.array_agg(tt.game_table_id ORDER BY tt.id),ARRAY[]::uuid[])
    INTO current_ids,current_physical FROM public.tournament_tables tt
    WHERE tt.tournament_id=tournament.id AND tt.status='active';
  IF current_ids IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'STALE_TABLE_CONFIG';
  END IF;
  -- Lock the whole physical scope in a stable order before child lifecycle RPCs.
  PERFORM 1 FROM public.game_tables g WHERE g.id=ANY(desired||current_physical)
    AND g.club_id=p_club_id ORDER BY g.id FOR UPDATE;
  IF (SELECT count(*) FROM public.game_tables g WHERE g.id=ANY(desired) AND g.club_id=p_club_id)
    <>pg_catalog.cardinality(desired) THEN RAISE EXCEPTION 'game_table_scope_mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_tables tt
    LEFT JOIN public.table_sessions s ON s.id=tt.table_session_id
    WHERE tt.tournament_id=tournament.id AND (tt.status='active' OR tt.status IS NULL)
      AND (tt.game_table_id IS NULL OR tt.table_session_id IS NULL
        OR (tt.table_id IS NOT NULL AND tt.table_id<>tt.game_table_id)
        OR s.closed_at IS NOT NULL OR s.club_id IS DISTINCT FROM p_club_id
        OR s.tournament_id IS DISTINCT FROM tournament.id OR s.game_table_id IS DISTINCT FROM tt.game_table_id)) THEN
    RAISE EXCEPTION 'configuration_table_repair_required';
  END IF;
  FOR link IN SELECT tt.id,tt.game_table_id,s.revision FROM public.tournament_tables tt
    JOIN public.table_sessions s ON s.id=tt.table_session_id
    WHERE tt.tournament_id=tournament.id AND tt.status='active'
      AND NOT(tt.game_table_id=ANY(desired)) ORDER BY tt.game_table_id LOOP
    nested_result:=public.close_tournament_table_v3(link.id,link.revision,
      pg_catalog.md5(p_request_id::text||':close:'||link.id::text)::uuid);
    IF (nested_result->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'configuration_table_close_rejected' USING DETAIL=nested_result::text;
    END IF;
  END LOOP;
  FOREACH physical IN ARRAY desired LOOP
    IF NOT EXISTS(SELECT 1 FROM public.tournament_tables tt WHERE tt.tournament_id=tournament.id
      AND tt.game_table_id=physical AND tt.status='active') THEN
      nested_result:=public.floor_open_tournament_table_v3(tournament.id,physical,'manual',
        pg_catalog.md5(p_request_id::text||':open:'||physical::text)::uuid);
      IF (nested_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'configuration_table_open_rejected' USING DETAIL=nested_result::text;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.tournaments t SET name=pg_catalog.btrim(p_config->>'name'),
    description=p_config->>'description',swing_duration_minutes=duration,
    warn_at_minutes=warning,crit_at_minutes=critical,updated_at=pg_catalog.clock_timestamp()
    WHERE t.id=tournament.id RETURNING * INTO tournament;
  result:=pg_catalog.jsonb_build_object('ok',true,'tournament',pg_catalog.to_jsonb(tournament));
  PERFORM floor_private.floor_table_v3_save_receipt(actor,'save_tournament_config_v1',p_request_id,fingerprint,result);
  RETURN result;
  -- Intentionally no catch-and-return: any child/receipt failure rolls back all writes.
END;
$function$;
REVOKE ALL ON FUNCTION public.save_tournament_config_v1(uuid,uuid,jsonb,uuid[],timestamptz,uuid[],uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_tournament_config_v1(uuid,uuid,jsonb,uuid[],timestamptz,uuid[],uuid,uuid)
  TO authenticated;

CREATE FUNCTION public.get_tournament_config_save_receipt_v1(p_request_id uuid, p_expected_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE receipt record; club uuid;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_expected_actor_id OR auth.uid() IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_changed'); END IF;
  IF auth.uid() IS NULL OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_receipt_request'); END IF;
  SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(auth.uid(),'save_tournament_config_v1',p_request_id);
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','receipt_not_found'); END IF;
  club:=(receipt.result->'tournament'->>'club_id')::uuid;
  IF (floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),club) IS TRUE
    OR public.is_club_dealer_control(auth.uid(),club) IS TRUE) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  RETURN receipt.result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_tournament_config_save_receipt_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_config_save_receipt_v1(uuid,uuid) TO authenticated;
COMMIT;
