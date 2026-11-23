-- A reservation on an existing seated assignment must verify the incoming
-- attendance. The unchanged outgoing seat may legitimately be overdue.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $$
DECLARE
  body text := replace(pg_get_functiondef('floor_private.guard_dealer_assignment_acquisition()'::regprocedure), chr(13), '');
  declaration text := 'DECLARE v_acquiring boolean:=false; v_club_id uuid;';
  age_predicate text := '        AND floor_private.dealer_pool_attendance_matches_v1(a.dealer_id,v_club_id,pg_catalog.statement_timestamp())';
  primary_guard text := 'IF NEW.attendance_id IS NULL OR NOT EXISTS(';
BEGIN
  IF md5(body) <> '59d94669c91e5a686543c1f7ece4ef2c'
    OR cardinality(string_to_array(body, declaration)) <> 2
    OR cardinality(string_to_array(body, age_predicate)) <> 3
    OR cardinality(string_to_array(body, primary_guard)) <> 2
  THEN
    RAISE EXCEPTION 'dealer_acquisition347_definition_drift';
  END IF;
  body := replace(body, declaration, declaration || ' v_same_seated_binding boolean:=false;');
  body := replace(body, primary_guard, $patch$IF TG_OP = 'UPDATE' THEN
      v_same_seated_binding := OLD.status = 'assigned' AND NEW.status = 'assigned'
        AND OLD.released_at IS NULL
        AND ROW(NEW.attendance_id, NEW.dealer_id, NEW.table_id, NEW.table_session_id, NEW.club_id)
          IS NOT DISTINCT FROM ROW(OLD.attendance_id, OLD.dealer_id, OLD.table_id, OLD.table_session_id, OLD.club_id);
    END IF;
    IF NEW.attendance_id IS NULL OR NOT EXISTS($patch$);
  -- Replace only the first predicate, for the seated attendance.
  body := overlay(body placing
    '        AND (v_same_seated_binding OR floor_private.dealer_pool_attendance_matches_v1(a.dealer_id,v_club_id,pg_catalog.statement_timestamp()))'
    from position(age_predicate in body) for length(age_predicate));
  EXECUTE body;
END $$;
COMMIT;
