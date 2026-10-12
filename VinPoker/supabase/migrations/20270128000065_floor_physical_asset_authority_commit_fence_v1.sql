-- Forward repair for migration63. Never apply63 alone as the final live API.
-- Recheck canonical authority after each blocking lock before replay/allocation.
-- ROLLBACK: hide declaration UI and revoke authenticated execution via reviewed
-- forward migration; retain assets/receipts. Do not restore the vulnerable body.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='declare_club_physical_table_v1') IS DISTINCT FROM 1
    OR pg_catalog.to_regprocedure('public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'physical_asset_authority65_signature_preflight_failed';
  END IF;
  IF (SELECT md5(pg_catalog.pg_get_functiondef(p.oid))='f6539c58bf0ddba6e7ef1fdf97af6e2a'
      AND p.proowner='postgres'::regrole AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=""']::text[]
      FROM pg_catalog.pg_proc p WHERE p.oid='public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)'::regprocedure)
    IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'physical_asset_authority65_body_preflight_failed';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.declare_club_physical_table_v1(
  p_club_id uuid, p_table_number integer, p_request_id uuid, p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_operation constant text := 'declare_physical_table_v1';
  v_fingerprint text;
  v_receipt record;
  v_asset uuid;
  v_result jsonb;
  v_constraint text;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
  IF v_actor IS DISTINCT FROM p_expected_actor_id THEN
    RETURN jsonb_build_object('ok',false,'error','ACTOR_CHANGED');
  END IF;
  IF (public.is_club_dealer_control(v_actor,p_club_id)
      OR public.has_role(v_actor,'super_admin'::public.app_role)
      OR public.is_club_admin(v_actor,p_club_id)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF p_club_id IS NULL OR p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  IF p_table_number IS NULL OR p_table_number NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_table_number');
  END IF;
  v_fingerprint := jsonb_build_object('club_id',p_club_id,'table_number',p_table_number)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor,v_operation,p_request_id);
  -- Membership may have been revoked while waiting on the receipt mutex.
  IF (public.is_club_dealer_control(v_actor,p_club_id)
      OR public.has_role(v_actor,'super_admin'::public.app_role)
      OR public.is_club_admin(v_actor,p_club_id)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(v_actor,v_operation,p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;
  PERFORM 1 FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','club_not_found'); END IF;
  -- The canonical authority check must occur after the club lock wait too.
  IF (public.is_club_dealer_control(v_actor,p_club_id)
      OR public.has_role(v_actor,'super_admin'::public.app_role)
      OR public.is_club_admin(v_actor,p_club_id)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_tables WHERE club_id=p_club_id
      AND (table_number=p_table_number OR table_name='Bàn '||p_table_number::text)) THEN
    RETURN jsonb_build_object('ok',false,'error','table_number_taken');
  END IF;
  BEGIN
    INSERT INTO public.game_tables(club_id,table_name,table_number,table_type,game_type,status,operational_status)
    VALUES(p_club_id,'Bàn '||p_table_number::text,p_table_number,'tournament','NLH','inactive','available')
    RETURNING id INTO v_asset;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
    IF v_constraint NOT IN ('uq_game_tables_club_table_number_v3','idx_game_tables_unassigned_unique',
        'game_tables_club_table_shift_unique') THEN RAISE; END IF;
    RETURN jsonb_build_object('ok',false,'error','table_number_taken');
  END;
  v_result := jsonb_build_object('ok',true,'game_table_id',v_asset,'actor_id',v_actor,
    'club_id',p_club_id,'table_number',p_table_number,'status','inactive','operational_status','available');
  PERFORM floor_private.floor_table_v3_save_receipt(v_actor,v_operation,p_request_id,v_fingerprint,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.declare_club_physical_table_v1(uuid,integer,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.declare_club_physical_table_v1(uuid,integer,uuid,uuid) TO authenticated;
COMMIT;
