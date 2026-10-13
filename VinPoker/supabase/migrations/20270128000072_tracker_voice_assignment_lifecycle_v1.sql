-- Forward-only shared Voice operational-assignment validity; no legacy repair.
-- Compensation must restore the captured pre72 helper in a NEW migration.
-- NOWAIT is explicit fail-closed busy, not a retry or attendance-state mutation.
BEGIN;
DO $migration$
DECLARE
 signature regprocedure:='public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure;
 definition text;
 original_metadata jsonb;
 after_metadata jsonb;
 lock_start integer;
 lock_end integer;
 authority_start integer;
 authority_end integer;
 authority_query text;
 authority_anchor text:='  IF v_assignment.user_id IS DISTINCT FROM p_actor';
 assignment_join text:='  JOIN public.dealers dealer_row'||chr(10)||'    ON dealer_row.id = assignment_row.dealer_id';
 valid_anchor text:='      WHERE dealer_row.club_id = v_tour.club_id'||chr(10)||'        AND dealer_row.status = ''active''';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF md5(definition)<>'96ba904dfcdfaa23dba36b6862aba168' THEN RAISE EXCEPTION 'voice_assignment72_baseline_drift'; END IF;
 IF md5(replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'f1f8d600607c96653f1ea1c0f950c119'
 OR md5(replace(pg_get_functiondef('public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure),chr(13),''))<>'16006fec6f3b9274581de471a9dc296a' THEN
  RAISE EXCEPTION 'voice_assignment72_requires_ordered70_71';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO original_metadata FROM pg_proc WHERE oid=signature;
 IF original_metadata->>'owner'<>'postgres' OR original_metadata->>'definer'<>'true'
 OR original_metadata->>'acl'<>'{postgres=X/postgres}'
 OR original_metadata->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb THEN
  RAISE EXCEPTION 'voice_assignment72_authority_drift';
 END IF;
 -- Do not reuse actor authority read before a possible context-lock wait.
 authority_start:=position('  SELECT'||chr(10)||'    EXISTS ('||chr(10)||'      SELECT 1'||chr(10)||'      FROM public.clubs club_row' in definition);
 authority_end:=position('  SELECT'||chr(10)||'    table_row.id AS tournament_table_id' in definition);
 IF authority_start=0 OR authority_end<=authority_start OR position(authority_anchor in definition)=0 THEN
  RAISE EXCEPTION 'voice_assignment72_actor_anchor_missing';
 END IF;
 authority_query:=substring(definition from authority_start for authority_end-authority_start);
 definition:=left(definition,authority_start-1)||substring(definition from authority_end);
 definition:=replace(definition,authority_anchor,authority_query||authority_anchor);
 lock_start:=position('  PERFORM 1'||chr(10)||'  FROM public.dealer_assignments assignment_row' in definition);
 lock_end:=position('  SELECT'||chr(10)||'    pg_catalog.count(*)::INTEGER,' in definition);
 IF lock_start=0 OR lock_end<=lock_start THEN RAISE EXCEPTION 'voice_assignment72_lock_anchor_missing'; END IF;
 definition:=left(definition,lock_start-1)||$lock$
  -- Keep existing session -> assignment/dealer ordering. Fail closed instead
  -- of waiting on an attendance-first checkout writer and forming a cycle.
  BEGIN
    PERFORM 1
    FROM public.dealer_assignments assignment_row
    JOIN public.dealers dealer_row ON dealer_row.id = assignment_row.dealer_id
    WHERE assignment_row.table_id = v_table_session.physical_table_id
      AND assignment_row.table_session_id = v_table_session.table_session_id
      AND assignment_row.status = 'assigned' AND assignment_row.released_at IS NULL
    FOR SHARE OF assignment_row, dealer_row NOWAIT;
    PERFORM 1 FROM public.dealer_attendance attendance_row
    WHERE attendance_row.id IN (
      SELECT assignment_row.attendance_id FROM public.dealer_assignments assignment_row
      WHERE assignment_row.table_id = v_table_session.physical_table_id
        AND assignment_row.table_session_id = v_table_session.table_session_id
        AND assignment_row.status = 'assigned' AND assignment_row.released_at IS NULL)
    ORDER BY attendance_row.id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','dealer_assignment_busy');
  END;

$lock$||substring(definition from lock_end);
 -- Count all active assignment candidates; invalid tuples must not disappear
 -- from the ambiguity count. Only the operational count filters validity.
 IF position(assignment_join in definition)=0 OR position(valid_anchor in definition)=0 THEN RAISE EXCEPTION 'voice_assignment72_validity_anchor_missing'; END IF;
 definition:=replace(definition,assignment_join,assignment_join||chr(10)||'  LEFT JOIN public.dealer_attendance attendance_row ON attendance_row.id = assignment_row.attendance_id');
 definition:=replace(definition,valid_anchor,valid_anchor||$valid$
        AND dealer_row.deleted_at IS NULL
        AND assignment_row.club_id = v_tour.club_id
        AND attendance_row.dealer_id = assignment_row.dealer_id
        AND attendance_row.status = 'checked_in'
        AND attendance_row.check_out_time IS NULL
        AND attendance_row.current_state IN ('assigned','on_break')
$valid$);
 definition:=replace(definition,chr(13),'');
 EXECUTE definition;
 IF md5(replace(pg_get_functiondef(signature),chr(13),''))<>md5(definition)
 OR md5(definition)<>'0a9e1f4e0972015b1554d6cd10f5ee2a' THEN RAISE EXCEPTION 'voice_assignment72_definition_postcheck'; END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_metadata FROM pg_proc WHERE oid=signature;
 IF original_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'voice_assignment72_metadata_postcheck'; END IF;
END;
$migration$;
COMMIT;
