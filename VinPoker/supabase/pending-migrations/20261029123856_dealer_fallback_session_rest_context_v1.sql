-- Pending LOCAL candidate; CLI scaffold20261029123856, not active ledger.
-- Keep selection/authorization/receipts intact. Compensation for the actual
-- fallback uses its actual destination session type and complete rest minutes.
-- Rollback: restore saved definition in a reviewed forward migration. Preserve
-- assignments/rest/payroll history; this migration does not rewrite any facts.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $patch$
DECLARE before_row record; after_row record; definition text; patched text;
 target regprocedure:='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
 old_declare text:=E'  v_fallback_rest_deficit integer;';
 new_declare text:=E'  v_fallback_rest_deficit integer;\n  v_fallback_table_type text;';
 old_query text:=$old$    SELECT GREATEST(0,COALESCE(sc.break_duration_minutes,15)
      -GREATEST(0,(dsm.minutes_since_rest*60)::integer/60))
    INTO STRICT v_fallback_rest_deficit
    FROM public.dealer_shift_metrics dsm
    LEFT JOIN public.swing_config sc ON sc.club_id=v_club_id AND sc.table_type='cash'
    WHERE dsm.attendance_id=v_next_attendance_id;$old$;
 new_query text:=$new$    -- The outgoing attendance is already in_transition here. Inventory's
    -- stable-state classification is intentionally unsuitable at this boundary.
    SELECT actual_session.session_type INTO STRICT v_fallback_table_type
    FROM public.dealer_assignments actual_assignment
    JOIN public.table_sessions actual_session
      ON actual_session.id=actual_assignment.table_session_id
      AND actual_session.club_id=v_club_id
      AND actual_session.game_table_id=v_table_id AND actual_session.closed_at IS NULL
    WHERE actual_assignment.id=p_assignment_id AND actual_assignment.club_id=v_club_id
      AND actual_assignment.table_id=v_table_id
      AND actual_assignment.status='assigned' AND actual_assignment.released_at IS NULL;
    IF v_fallback_table_type NOT IN ('cash','tournament','vip') THEN
      RAISE EXCEPTION 'SWING_FALLBACK_SESSION_TYPE_INVALID';
    END IF;
    SELECT GREATEST(0,GREATEST(15,COALESCE(sc.break_duration_minutes,15),
        COALESCE(sc.min_inter_swing_rest_minutes,15))
      -floor(GREATEST(0,dsm.minutes_since_rest))::integer)
    INTO STRICT v_fallback_rest_deficit
    FROM public.dealer_shift_metrics dsm
    LEFT JOIN public.swing_config sc ON sc.club_id=v_club_id AND sc.table_type=v_fallback_table_type
    WHERE dsm.attendance_id=v_next_attendance_id AND dsm.club_id=v_club_id
      AND dsm.minutes_since_rest IS NOT NULL
      AND (sc.club_id IS NULL OR ((sc.break_duration_minutes IS NULL OR sc.break_duration_minutes>=0)
        AND (sc.min_inter_swing_rest_minutes IS NULL OR sc.min_inter_swing_rest_minutes>=0)));$new$;
BEGIN
 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') AS definition
 INTO STRICT before_row FROM pg_proc p WHERE oid=target;
 IF current_user<>'postgres' OR md5(before_row.prosrc)<>'f198b854c3380ea443cba8be404b528b'
 OR pg_get_userbyid(before_row.proowner)<>'postgres'
 OR to_regclass('floor_private.dealer_fallback_session_rest_definition_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'dealer_fallback_session_rest_dependency_drift_or_collision';
 END IF;
 definition:=before_row.definition;
 IF cardinality(string_to_array(definition,old_declare))<>2
 OR cardinality(string_to_array(definition,old_query))<>2 THEN
  RAISE EXCEPTION 'dealer_fallback_session_rest_anchor_drift';
 END IF;
 CREATE TABLE floor_private.dealer_fallback_session_rest_definition_v1(
   signature text PRIMARY KEY,definition text NOT NULL,
   recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.dealer_fallback_session_rest_definition_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.dealer_fallback_session_rest_definition_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.dealer_fallback_session_rest_definition_v1(signature,definition)
 VALUES(target::text,pg_get_functiondef(target));
 patched:=replace(replace(definition,old_declare,new_declare),old_query,new_query);
 EXECUTE patched;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=target;
 IF after_row.prosrc IS NOT DISTINCT FROM before_row.prosrc
 OR after_row.proacl IS DISTINCT FROM before_row.proacl OR after_row.proowner<>before_row.proowner
 OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef OR after_row.proconfig IS DISTINCT FROM before_row.proconfig
 OR after_row.provolatile IS DISTINCT FROM before_row.provolatile OR after_row.prolang<>before_row.prolang
 OR after_row.proisstrict IS DISTINCT FROM before_row.proisstrict OR after_row.proparallel<>before_row.proparallel THEN
  RAISE EXCEPTION 'dealer_fallback_session_rest_metadata_changed';
 END IF;
END $patch$;
COMMIT;
