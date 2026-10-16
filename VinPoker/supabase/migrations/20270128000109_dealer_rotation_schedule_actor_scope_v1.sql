-- CLI candidate 20261016032129; local catalog reserved 109.
-- Requires live catalog/digest and caller review before release.
-- Cancellation remains available while Auto is OFF; acquisition triggers remain
-- authoritative for locking. No attendance, rest, or payroll policy changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION floor_private.assert_rotation_schedule_actor_v1(
  p_schedule_id uuid, p_cancellation boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_role text := pg_catalog.current_setting('role', true);
  v_club uuid;
  v_actor uuid;
BEGIN
  -- current_user is the enclosing SECURITY DEFINER owner, not the invoker.
  -- JWT role alone cannot authorize a service operation.
  IF v_role IS NOT NULL AND v_role <> 'none'
     AND pg_catalog.pg_has_role(v_role, 'service_role', 'MEMBER') THEN
    RETURN;
  END IF;
  IF v_role = 'none' AND session_user = 'postgres' THEN
    RETURN;
  END IF;
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'ROTATION_SCHEDULE_ACTOR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT s.club_id INTO v_club
  FROM public.dealer_rotation_schedule s
  JOIN public.game_tables t ON t.id = s.table_id AND t.club_id = s.club_id
  WHERE s.id = p_schedule_id;
  IF NOT FOUND THEN
    -- No mutation is possible for a missing row; preserve outer RPC semantics.
    IF NOT EXISTS (SELECT 1 FROM public.dealer_rotation_schedule WHERE id = p_schedule_id) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'ROTATION_SCHEDULE_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;
  IF public.is_club_dealer_control(v_actor, v_club)
     OR (p_cancellation AND (
       public.is_club_floor(v_actor, v_club)
       OR public.has_role(v_actor, 'super_admin'::public.app_role)
     )) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'ROTATION_SCHEDULE_ACTOR_FORBIDDEN' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION floor_private.assert_rotation_schedule_actor_v1(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE
  v_target regprocedure;
  v_definition text;
  v_digest text;
  v_cancel boolean;
  v_anchor text;
  v_call text;
BEGIN
  FOR v_target, v_digest, v_cancel IN
    SELECT 'public.cancel_rotation_slot(uuid,text)'::regprocedure,
           '9daf120e3fa846e3468d7a154fb52b56', true
    UNION ALL
    SELECT 'public.lock_rotation_slot(uuid,integer)'::regprocedure,
           'fdceb8dbf610ba45a9868dd23fb9ac4a', false
  LOOP
    v_definition := replace(pg_get_functiondef(v_target), chr(13), '');
    IF md5(v_definition) <> v_digest THEN
      RAISE EXCEPTION 'rotation_schedule_actor_definition_drift: %', v_target;
    END IF;
    v_call := format('PERFORM floor_private.assert_rotation_schedule_actor_v1(p_schedule_id, %s);',
                     CASE WHEN v_cancel THEN 'true' ELSE 'false' END);
    -- Preserve original lock order and FOUND: check before SELECT and only
    -- recheck after the original missing-row branch has consumed FOUND.
    v_definition := replace(v_definition, E'BEGIN\n', E'BEGIN\n  ' || v_call || E'\n');
    v_anchor := CASE WHEN v_cancel THEN
      '  IF v_row.status NOT IN' ELSE '  IF v_row.status !=' END;
    IF strpos(v_definition, v_anchor) = 0 THEN
      RAISE EXCEPTION 'rotation_schedule_actor_anchor_missing: %', v_target;
    END IF;
    v_definition := replace(v_definition, v_anchor, '  ' || v_call || E'\n\n' || v_anchor);
    EXECUTE v_definition;
  END LOOP;
END;
$patch$;
COMMIT;
