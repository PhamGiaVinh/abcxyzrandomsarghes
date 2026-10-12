-- Scoped emergency OFF capability; does not grant general settings access.
-- ROLLBACK: hide the new UI and revoke this RPC in a reviewed forward migration.
-- Preserve settings and immutable receipts. Never turn Auto ON during rollback.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='operator_stop_dealer_swing_v1') THEN
    RAISE EXCEPTION 'swing_stop_existing_overload_preflight_failed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE operation_type='operator_stop_swing_v1') THEN
    RAISE EXCEPTION 'swing_stop_existing_receipt_namespace_preflight_failed';
  END IF;
END $$;

CREATE FUNCTION public.operator_stop_dealer_swing_v1(
  p_club_id uuid,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s'
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_operation constant text:='operator_stop_swing_v1';
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
  v_enabled boolean;
  v_replay boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','unauthorized');
  END IF;
  IF v_actor IS DISTINCT FROM p_expected_actor_id THEN
    RETURN jsonb_build_object('ok',false,'error','ACTOR_CHANGED');
  END IF;
  IF p_club_id IS NULL OR p_request_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  IF (public.is_club_dealer_control(v_actor,p_club_id)
    OR public.is_club_admin(v_actor,p_club_id)
    OR public.has_role(v_actor,'super_admin'::public.app_role)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.clubs WHERE id=p_club_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','club_not_found'); END IF;
  v_fingerprint:=jsonb_build_object('operation',v_operation,'actor_id',v_actor,'club_id',p_club_id)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor,v_operation,p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(v_actor,v_operation,p_request_id);
  v_replay:=FOUND;
  IF v_replay AND v_receipt.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
    RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
  END IF;

  -- Same row lock serializes with fence22's automatic-acquisition FOR SHARE.
  -- Never create settings: their defaults can activate unrelated policies.
  SELECT s.auto_swing_enabled INTO v_enabled FROM public.club_settings s
    WHERE s.club_id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','settings_missing'); END IF;
  -- Authority may be revoked while the settings lock is being acquired.
  IF (public.is_club_dealer_control(v_actor,p_club_id)
    OR public.is_club_admin(v_actor,p_club_id)
    OR public.has_role(v_actor,'super_admin'::public.app_role)) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
  END IF;
  IF v_enabled IS NULL THEN RETURN jsonb_build_object('ok',false,'error','settings_unverified'); END IF;
  IF v_replay THEN
    v_result:=v_receipt.result;
  ELSE
    v_result:=jsonb_build_object('actor_id',v_actor,'club_id',p_club_id,'request_id',p_request_id,
      'auto_swing_enabled',false,'outcome',CASE WHEN v_enabled THEN 'applied' ELSE 'unchanged' END);
    IF v_enabled THEN
      UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id=p_club_id;
      v_enabled:=false;
    END IF;
    PERFORM floor_private.floor_table_v3_save_receipt(v_actor,v_operation,p_request_id,v_fingerprint,v_result);
  END IF;
  -- The receipt is immutable; this separately named projection is a current
  -- read under lock, not a historical receipt claiming Auto is still OFF.
  RETURN jsonb_build_object('ok',true,'receipt',v_result,
    'current_state',jsonb_build_object('club_id',p_club_id,'auto_swing_enabled',v_enabled));
END $$;
REVOKE ALL ON FUNCTION public.operator_stop_dealer_swing_v1(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_stop_dealer_swing_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
