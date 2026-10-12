-- Numbered physical-asset declaration. Does not open a session or repair history.
-- Depends on Floor V3 private receipt helpers and existing inventory constraints.
-- ROLLBACK: revoke authenticated execution via a reviewed forward migration and
-- hide the declaration UI. Retain assets/receipts; never delete referenced rows.
BEGIN;

-- New API has never been live. Any unexpected overload is drift, not permission
-- to overwrite/delete a function or retain an unfenced alternative.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='declare_club_physical_table_v1') THEN
    RAISE EXCEPTION 'physical_asset_existing_overload_preflight_failed';
  END IF;
END $$;

CREATE FUNCTION public.declare_club_physical_table_v1(
  p_club_id uuid,
  p_table_number integer,
  p_request_id uuid,
  p_expected_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_operation constant text := 'declare_physical_table_v1';
  v_fingerprint text;
  v_receipt record;
  v_asset uuid;
  v_result jsonb;
  v_constraint text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  -- CAS fence only: the expected actor never supplies authorization. This
  -- rejects an old UI intent if the SDK asynchronously selects a new token.
  IF v_actor IS DISTINCT FROM p_expected_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACTOR_CHANGED');
  END IF;
  -- Preserve the existing game_tables INSERT policy exactly. Floor/Cashier
  -- tournament-operation authority must not become physical-asset authority.
  IF (public.is_club_dealer_control(v_actor, p_club_id)
      OR public.has_role(v_actor, 'super_admin'::public.app_role)
      OR public.is_club_admin(v_actor, p_club_id)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF p_club_id IS NULL OR p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  IF p_table_number IS NULL OR p_table_number NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_number');
  END IF;

  v_fingerprint := jsonb_build_object('club_id', p_club_id,
    'table_number', p_table_number)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, v_operation, p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, v_operation, p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  -- Bound allocation to one club; uniqueness remains the concurrent-writer
  -- backstop. Never adopt/upsert a pre-existing numbered or legacy named asset.
  PERFORM 1 FROM public.clubs WHERE id = p_club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'club_not_found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_tables
    WHERE club_id = p_club_id
      AND (table_number = p_table_number OR table_name = 'Bàn ' || p_table_number::text)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_number_taken');
  END IF;

  BEGIN
    INSERT INTO public.game_tables
      (club_id, table_name, table_number, table_type, game_type, status, operational_status)
    VALUES
      (p_club_id, 'Bàn ' || p_table_number::text, p_table_number,
       'tournament', 'NLH', 'inactive', 'available')
    RETURNING id INTO v_asset;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint NOT IN ('uq_game_tables_club_table_number_v3',
      'idx_game_tables_unassigned_unique', 'game_tables_club_table_shift_unique') THEN
      RAISE;
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'table_number_taken');
  END;

  v_result := jsonb_build_object('ok', true, 'game_table_id', v_asset, 'actor_id', v_actor,
    'club_id', p_club_id, 'table_number', p_table_number,
    'status', 'inactive', 'operational_status', 'available');
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, v_operation, p_request_id, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)
  TO authenticated;

COMMIT;
