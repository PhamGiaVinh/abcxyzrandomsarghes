-- Compensation SOURCE only; promote to a NEW reviewed migration for live use.
-- Restores known-bug baseline96 temporarily; does not claim bug remediation.
-- No hand, card, chip, attendance, receipt or audit rows are rewound.
BEGIN;
DO $guard$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'0a9e1f4e0972015b1554d6cd10f5ee2a'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'f1f8d600607c96653f1ea1c0f950c119'
 OR md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'16006fec6f3b9274581de471a9dc296a' THEN
  RAISE EXCEPTION 'rollback72_source_or_order_drift';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proacl::text='{postgres=X/postgres}' AND proconfig=ARRAY['search_path=""']) THEN
  RAISE EXCEPTION 'rollback72_authority_drift';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public._tracker_voice_assignment_context(p_tournament_id uuid, p_tournament_table_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tour RECORD;
  v_table_session RECORD;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_assignment_count INTEGER := 0;
  v_operational_assignment_count INTEGER := 0;
  v_assignment RECORD;
  v_global_enabled BOOLEAN := FALSE;
  v_actor_is_owner_or_floor BOOLEAN := FALSE;
BEGIN
  IF p_actor IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT tournament_row.id, tournament_row.club_id, tournament_row.name
  INTO v_tour
  FROM public.tournaments tournament_row
  WHERE tournament_row.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.clubs club_row
      WHERE club_row.id = v_tour.club_id
        AND club_row.owner_id = p_actor
    )
    OR COALESCE(public.is_club_floor(p_actor, v_tour.club_id), FALSE)
    OR COALESCE(public.is_club_admin(p_actor, v_tour.club_id), FALSE)
  INTO v_actor_is_owner_or_floor;

  SELECT
    table_row.id AS tournament_table_id,
    table_row.table_name,
    table_row.status AS table_status,
    table_row.game_table_id AS physical_table_id,
    session_row.id AS table_session_id,
    session_row.control_epoch
  INTO v_table_session
  FROM public.tournament_tables table_row
  JOIN public.table_sessions session_row
    ON session_row.id = table_row.table_session_id
  WHERE table_row.id = p_tournament_table_id
    AND table_row.tournament_id = p_tournament_id
    AND table_row.status = 'active'
    AND table_row.game_table_id IS NOT NULL
    AND session_row.closed_at IS NULL
    AND session_row.session_type = 'tournament'
    AND session_row.control_mode = 'tracker'
    AND session_row.club_id = v_tour.club_id
    AND session_row.tournament_id = v_tour.id
    AND session_row.game_table_id = table_row.game_table_id
  FOR SHARE OF table_row, session_row;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'voice_table_session_not_tracker',
      'tournament_id', v_tour.id,
      'tournament_table_id', p_tournament_table_id
    );
  END IF;

  IF NOT floor_private.floor_table_v3_assert_tracker_context(
    p_tournament_id,
    p_tournament_table_id,
    v_table_session.table_session_id,
    v_table_session.control_epoch
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_table_session_not_tracker');
  END IF;

  SELECT settings.value = 'true'::JSONB
  INTO v_global_enabled
  FROM public.app_settings settings
  WHERE settings.key = 'tracker_voice_global_enabled'
  FOR SHARE;
  IF COALESCE(v_global_enabled, FALSE) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_global_disabled');
  END IF;

  SELECT *
  INTO v_config
  FROM public.tracker_voice_configs config_row
  WHERE config_row.tournament_id = v_tour.id
    AND config_row.tournament_table_id = v_table_session.tournament_table_id
  FOR SHARE;
  IF NOT FOUND
     OR v_config.club_id IS DISTINCT FROM v_tour.club_id
     OR v_config.physical_table_id IS DISTINCT FROM v_table_session.physical_table_id
     OR v_config.table_session_id IS DISTINCT FROM v_table_session.table_session_id
     OR v_config.control_epoch IS DISTINCT FROM v_table_session.control_epoch THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_config_stale');
  END IF;
  IF v_config.enabled IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_config_disabled');
  END IF;

  PERFORM 1
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL
  FOR SHARE OF assignment_row, dealer_row;

  SELECT
    pg_catalog.count(*)::INTEGER,
    pg_catalog.count(*) FILTER (
      WHERE dealer_row.club_id = v_tour.club_id
        AND dealer_row.status = 'active'
    )::INTEGER
  INTO v_assignment_count, v_operational_assignment_count
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL;

  IF v_assignment_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', CASE WHEN v_assignment_count = 0 THEN 'dealer_assignment_missing' ELSE 'dealer_assignment_ambiguous' END,
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_table_session.tournament_table_id,
      'physical_table_id', v_table_session.physical_table_id,
      'table_session_id', v_table_session.table_session_id,
      'club_id', v_tour.club_id
    );
  END IF;

  IF v_operational_assignment_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'dealer_assignment_invalid',
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_table_session.tournament_table_id,
      'physical_table_id', v_table_session.physical_table_id,
      'table_session_id', v_table_session.table_session_id,
      'club_id', v_tour.club_id
    );
  END IF;

  SELECT
    assignment_row.id AS assignment_id,
    dealer_row.id AS dealer_id,
    dealer_row.user_id
  INTO v_assignment
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL;

  IF v_assignment.user_id IS DISTINCT FROM p_actor
     AND v_actor_is_owner_or_floor IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'dealer_assignment_missing',
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_table_session.tournament_table_id,
      'physical_table_id', v_table_session.physical_table_id,
      'table_session_id', v_table_session.table_session_id,
      'club_id', v_tour.club_id
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'club_id', v_tour.club_id,
    'tournament_id', v_tour.id,
    'tournament_name', v_tour.name,
    'tournament_table_id', v_table_session.tournament_table_id,
    'physical_table_id', v_table_session.physical_table_id,
    'table_session_id', v_table_session.table_session_id,
    'control_epoch', v_table_session.control_epoch,
    'table_name', v_table_session.table_name,
    'table_status', v_table_session.table_status,
    'dealer_id', v_assignment.dealer_id,
    'assignment_id', v_assignment.assignment_id
  );
END;
$function$;
DO $postcheck$
BEGIN
 IF md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'96ba904dfcdfaa23dba36b6862aba168' THEN
  RAISE EXCEPTION 'rollback72_definition_postcheck';
 END IF;
END;
$postcheck$;
COMMIT;
