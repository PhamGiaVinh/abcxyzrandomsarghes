-- CLI candidate 20261016003744; forward local catalog103, NOT applied live.
-- An inner perform_swing overload can catch an exception and return JSON after
-- the outer overload has already marked the outgoing attendance in_transition.
-- Roll back those intermediate writes on rejected outcomes, not just exceptions.
-- Preserve existing successful swing and explicit no_dealer overtime semantics.
-- Recovery: keep automatic Swing OFF, restore captured worker22 definition/ACL
-- in a reviewed forward migration. Do not alter attendance/history to roll back.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure),chr(13),''))
   <>'000dfe42e72accb2ca83df44a3aedac4' THEN
   RAISE EXCEPTION 'worker_swing103_dependency_drift';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.worker_perform_swing(
  p_table_id uuid,p_table_session_id uuid,p_assignment_id uuid,
  p_duration_minutes integer DEFAULT 30,p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT 15,p_max_break_minutes integer DEFAULT 60,
  p_expected_version integer DEFAULT NULL,p_next_attendance_id uuid DEFAULT NULL,
  p_rest_deficit_minutes integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_club_id uuid; v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SWING_WORKER_FORBIDDEN'; END IF;
  IF p_expected_version IS NULL THEN RAISE EXCEPTION 'SWING_EXPECTED_VERSION_REQUIRED'; END IF;
  SELECT g.club_id INTO v_club_id FROM public.game_tables g WHERE g.id=p_table_id;
  PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);
  v_club_id:=public._dealer_swing_assert_exact_context(p_table_id,p_table_session_id,
    p_assignment_id,p_expected_version,p_next_attendance_id);
  BEGIN
    v_result:=public.perform_swing(p_assignment_id:=p_assignment_id,p_duration_minutes:=p_duration_minutes,
      p_send_to_break:=p_send_to_break,p_break_duration_minutes:=p_break_duration_minutes,
      p_max_break_minutes:=p_max_break_minutes,p_expected_version:=p_expected_version,
      p_next_attendance_id:=p_next_attendance_id,p_rest_deficit_minutes:=p_rest_deficit_minutes);
    v_result:=public._dealer_swing_bind_result_session(v_result,v_club_id,p_table_id,p_table_session_id);
    IF v_result->>'outcome' IS NULL OR v_result->>'outcome' NOT IN ('swung','no_dealer') THEN
      RAISE EXCEPTION 'worker_swing_rejected_result' USING ERRCODE='ZX103';
    END IF;
  EXCEPTION WHEN SQLSTATE 'ZX103' THEN
    -- PL/pgSQL variables retain the response while the subtransaction's table
    -- changes roll back, including outer in_transition and break housekeeping.
    RETURN v_result;
  END;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)
  TO service_role;
COMMIT;
