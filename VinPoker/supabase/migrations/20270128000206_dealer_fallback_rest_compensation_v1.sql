-- CLI scaffold20261020090445; reserved206 against local source/catalog.
-- Keep explicit incoming selection and existing pool/rest policy. If that
-- incoming loses a race, compensation belongs to the actual fallback.
-- No historical assignment/payroll/ledger rewrite; recovery prepared separately.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $migration$
DECLARE
 target regprocedure:='public.perform_swing(uuid,integer,boolean,integer,integer,integer,uuid,integer)'::regprocedure;
 before_row record;after_row record;definition text;patched text;
 old_declaration text:=E'  v_swing_result       JSONB;';
 new_declaration text:=E'  v_swing_result       JSONB;\n  v_fallback_rest_deficit integer;';
 old_call text:=E'    p_rest_deficit_minutes := p_rest_deficit_minutes\n';
 new_call text:=E'    p_rest_deficit_minutes := COALESCE(v_fallback_rest_deficit, p_rest_deficit_minutes)\n';
 anchor text:=E'  SELECT current_state INTO v_next_dealer_state\n  FROM dealer_attendance WHERE id = v_next_attendance_id;\n';
 addition text:=$addition$
  --206: row already locked by selection; do not reuse another dealer's deficit.
  IF p_next_attendance_id IS NOT NULL AND v_next_attendance_id IS DISTINCT FROM p_next_attendance_id THEN
    SELECT GREATEST(0,COALESCE(sc.break_duration_minutes,15)
      -GREATEST(0,(dsm.minutes_since_rest*60)::integer/60))
    INTO STRICT v_fallback_rest_deficit
    FROM public.dealer_shift_metrics dsm
    LEFT JOIN public.swing_config sc ON sc.club_id=v_club_id AND sc.table_type='cash'
    WHERE dsm.attendance_id=v_next_attendance_id;
  END IF;
$addition$;
BEGIN
 SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') AS definition INTO STRICT before_row FROM pg_proc p WHERE oid=target;
 definition:=before_row.definition;
 IF current_user<>'postgres' OR md5(definition)<>'8c47fa4e511eb3d5d622667fce71b134'
 OR pg_get_userbyid(before_row.proowner)<>'postgres' THEN RAISE EXCEPTION 'dealer206_dependency_drift'; END IF;
 IF cardinality(string_to_array(definition,old_declaration))<>2
 OR cardinality(string_to_array(definition,old_call))<>2
 OR cardinality(string_to_array(definition,anchor))<>2 THEN RAISE EXCEPTION 'dealer206_patch_anchor_drift'; END IF;
 patched:=replace(replace(replace(definition,old_declaration,new_declaration),old_call,new_call),anchor,anchor||addition);
 EXECUTE patched;
 SELECT * INTO STRICT after_row FROM pg_proc WHERE oid=target;
 IF after_row.prosrc IS NOT DISTINCT FROM before_row.prosrc OR after_row.proacl IS DISTINCT FROM before_row.proacl
 OR after_row.proowner<>before_row.proowner OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef
 OR after_row.proconfig IS DISTINCT FROM before_row.proconfig OR after_row.provolatile IS DISTINCT FROM before_row.provolatile THEN
  RAISE EXCEPTION 'dealer206_unexpected_metadata_change';
 END IF;
END $migration$;
COMMIT;
