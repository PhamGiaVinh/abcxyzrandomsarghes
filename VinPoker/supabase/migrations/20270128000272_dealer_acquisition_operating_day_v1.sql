-- New acquisitions must obey the same operating-day policy as check-in222.
-- No old attendance, checkout, payroll or released assignment is rewritten.
-- Recovery: restore exact prior guard definition from reviewed local backup;
-- never restore operational tables or remove historical attendance to recover.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ DECLARE body text; anchor text;
BEGIN
 body:=replace(pg_get_functiondef('floor_private.guard_dealer_assignment_acquisition()'::regprocedure),chr(13),'');
 IF md5(body)<>'b4fd007d3f601a72e21717096939497b'
 OR md5(replace(pg_get_functiondef('floor_private.dealer_pool_attendance_matches_v1(uuid,uuid,timestamptz)'::regprocedure),chr(13),''))<>'380e30a5877e74edfdcb15c879856f59'
 THEN RAISE EXCEPTION 'dealer_operating_day272_definition_drift'; END IF;
 anchor:='    PERFORM floor_private.assert_dealer_acquisition_intent(v_club_id);';
 IF cardinality(string_to_array(body,anchor))<>2 THEN RAISE EXCEPTION 'dealer_operating_day272_anchor_drift'; END IF;
 body:=replace(body,anchor,anchor||$guard$
    -- Check the primary and incoming binding, even for an authorized manual
    -- override. It overrides pool policy, not the identity/day of attendance.
    -- Attendance locks match the existing binding trigger's deterministic order.
    PERFORM 1 FROM public.dealer_attendance a
      WHERE a.id=ANY(ARRAY[NEW.attendance_id,NEW.pre_assigned_attendance_id]::uuid[])
      ORDER BY a.id FOR UPDATE;
    -- Shift close/archive/time edits must serialize with the day proof, not
    -- commit underneath a snapshot that has already accepted the old shift.
    PERFORM 1 FROM public.dealer_shifts s WHERE s.id IN(
      SELECT a.shift_id FROM public.dealer_attendance a
      WHERE a.id=ANY(ARRAY[NEW.attendance_id,NEW.pre_assigned_attendance_id]::uuid[])
    ) ORDER BY s.id FOR SHARE;
    IF NEW.attendance_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.dealer_attendance a WHERE a.id=NEW.attendance_id
        AND (NEW.dealer_id IS NULL OR NEW.dealer_id=a.dealer_id)
        AND floor_private.dealer_pool_attendance_matches_v1(a.dealer_id,v_club_id,pg_catalog.statement_timestamp())
    ) OR (NEW.pre_assigned_attendance_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.dealer_attendance a WHERE a.id=NEW.pre_assigned_attendance_id
        AND floor_private.dealer_pool_attendance_matches_v1(a.dealer_id,v_club_id,pg_catalog.statement_timestamp())
    )) THEN RAISE EXCEPTION 'DEALER_ACQUISITION_ATTENDANCE_STALE'; END IF;
$guard$);
 EXECUTE body;
END $$;
COMMIT;
