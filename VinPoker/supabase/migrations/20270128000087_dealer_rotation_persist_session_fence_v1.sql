-- CLI-created candidate, moved to reserved slot87 after catalog collision check.
-- Fence stale planner snapshots inside the same transaction as the set diff.
-- No rest/payroll/notification/flag changes. Capture prior function for rollback;
-- restore it only under worker containment, never resurrect old predictions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE original text; patched text; anchor text; guard text;
BEGIN
 SELECT replace(pg_get_functiondef('public.upsert_rotation_plan(uuid,uuid,jsonb,uuid[])'::regprocedure),chr(13),'') INTO original;
 IF md5(original)<>'a9fa4700cdd8b75e713ffcd7578155b6' THEN
   RAISE EXCEPTION 'rotation_persist_definition_drift';
 END IF;
 -- Change only body references, preserving the public signature and grants.
 patched:=replace(original,'COALESCE(p_rows,', 'COALESCE(v_valid_rows,');
 patched:=replace(patched,'p_table_ids IS NULL OR', 'v_valid_scope IS NULL OR');
 patched:=replace(patched,'ANY(p_table_ids)', 'ANY(v_valid_scope)');
 patched:=replace(patched,'  v_skipped     int := 0;', E'  v_skipped     int := 0;\n  v_valid_rows jsonb;\n  v_valid_scope uuid[];\n  v_requested_scope uuid[];\n  v_rejected_scope uuid[];\n  v_table uuid;');
 anchor:='  -- Count distinct incoming slots in scope.';
 guard:=$guard$
  SELECT COALESCE(array_agg(DISTINCT x),ARRAY[]::uuid[]) INTO v_requested_scope
  FROM (
    SELECT unnest(p_table_ids) x WHERE p_table_ids IS NOT NULL
    UNION
    SELECT (r->>'table_id')::uuid FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r
      WHERE p_table_ids IS NULL OR (r->>'table_id')::uuid=ANY(p_table_ids)
    UNION
    SELECT s.table_id FROM public.dealer_rotation_schedule s
      WHERE p_table_ids IS NULL AND s.club_id=p_club_id AND s.status='predicted'
  ) requested;
  -- Same outer lock as canonical open/close/perform_swing. Acquire tables in
  -- UUID order; schedule precedes assignment to match lock_rotation_slot.
  PERFORM 1 FROM public.game_tables g WHERE g.id=ANY(v_requested_scope)
    AND g.club_id=p_club_id ORDER BY g.id FOR UPDATE;
  PERFORM 1 FROM public.table_sessions s WHERE s.game_table_id=ANY(v_requested_scope)
    AND s.club_id=p_club_id AND s.closed_at IS NULL ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM public.dealer_rotation_schedule s WHERE s.table_id=ANY(v_requested_scope)
    AND s.club_id=p_club_id AND s.status IN ('predicted','announced','executing')
    ORDER BY s.id FOR UPDATE;
  PERFORM 1 FROM public.dealer_assignments a WHERE a.table_id=ANY(v_requested_scope)
    AND a.club_id=p_club_id AND a.released_at IS NULL ORDER BY a.id FOR UPDATE;
  v_valid_scope:=ARRAY[]::uuid[];
  v_rejected_scope:=ARRAY[]::uuid[];
  FOREACH v_table IN ARRAY v_requested_scope LOOP
    IF NOT EXISTS(SELECT 1 FROM floor_private.club_operational_inventory(p_club_id) i
      WHERE i.game_table_id=v_table AND i.availability_status='in_use')
      OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r
        WHERE (r->>'table_id')::uuid=v_table AND NOT (
          (COALESCE(NULLIF(r->>'slot_index','')::int,0)=0 AND EXISTS(
          SELECT 1 FROM public.dealer_assignments a JOIN public.table_sessions s
            ON s.id=a.table_session_id AND s.game_table_id=a.table_id AND s.club_id=a.club_id
          WHERE a.id=NULLIF(r->>'assignment_id','')::uuid AND a.table_id=v_table
            AND a.club_id=p_club_id AND a.status='assigned' AND a.released_at IS NULL
            AND a.swing_processed_at IS NULL AND s.closed_at IS NULL
          )) OR (
            NULLIF(r->>'slot_index','')::int BETWEEN 1 AND 4
            AND NULLIF(r->>'assignment_id','') IS NULL
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) anchor_row
              WHERE (anchor_row->>'table_id')::uuid=v_table
                AND COALESCE(NULLIF(anchor_row->>'slot_index','')::int,0)=0
                AND NULLIF(anchor_row->>'assignment_id','') IS NOT NULL)
          )
        )
      ) THEN
      v_rejected_scope:=array_append(v_rejected_scope,v_table);
    ELSE
      v_valid_scope:=array_append(v_valid_scope,v_table);
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(r),'[]'::jsonb) INTO v_valid_rows
  FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) r
  WHERE (r->>'table_id')::uuid=ANY(v_valid_scope);
$guard$;
 IF position(anchor IN patched)=0 OR position('v_valid_rows jsonb' IN patched)=0 THEN
   RAISE EXCEPTION 'rotation_persist_patch_anchor_missing';
 END IF;
 patched:=replace(patched,anchor,guard||E'\n'||anchor);
 patched:=replace(patched, E'''plan_run_id'', p_plan_run_id\n  );',
   E'''plan_run_id'', p_plan_run_id,\n    ''rejected_table_ids'', to_jsonb(v_rejected_scope)\n  );');
 IF position('rejected_table_ids' IN patched)=0 THEN RAISE EXCEPTION 'rotation_persist_receipt_anchor_missing'; END IF;
 EXECUTE patched;
END $migration$;
COMMIT;
