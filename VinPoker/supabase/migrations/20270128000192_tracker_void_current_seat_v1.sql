-- Forward-only candidate192. Preserve inactive historical busted seats when a
-- restored entry has a unique current active seat. Ambiguous busted entries
-- still fail closed; never select a historical row by newest timestamp.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $migration$
DECLARE definition text;marker text;replacement text;prior_acl aclitem[];
BEGIN
 SELECT replace(pg_get_functiondef(p.oid),chr(13),''),p.proacl INTO definition,prior_acl
 FROM pg_proc p WHERE p.oid='public.void_last_hand(uuid)'::regprocedure
 AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=public'];
 IF current_user<>'postgres' OR definition IS NULL
 OR md5(definition)<>'c7268aa942dbbf717aa9e5ba7acb58ff'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000192') THEN
  RAISE EXCEPTION 'tracker_void192_baseline_drift_or_collision';
 END IF;
 marker:=$old$          AND s.status IN ('active','busted'))<>1) THEN$old$;
 replacement:=$new$          AND ((e.status='seated' AND s.status='active' AND s.is_active)
            OR (e.status='busted' AND s.status='busted' AND NOT s.is_active)))<>1) THEN$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_void192_guard_marker_drift';END IF;
 definition:=replace(definition,marker,replacement);
 marker:=$old$      SET chip_count = v_player_record.starting_stack,
          is_active = CASE$old$;
 replacement:=$new$      SET chip_count = v_player_record.starting_stack,
          status = 'active',
          is_active = CASE$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_void192_status_marker_drift';END IF;
 definition:=replace(definition,marker,replacement);
 marker:=$old$          AND e.entry_no=v_player_record.entry_number);$old$;
 replacement:=$new$          AND e.entry_no=v_player_record.entry_number
          AND ((e.status='seated' AND t.status='active' AND t.is_active)
            OR (e.status='busted' AND t.status='busted' AND NOT t.is_active)));$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_void192_writer_marker_drift';END IF;
 definition:=replace(definition,marker,replacement);
 EXECUTE definition;
 IF (SELECT proacl FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure) IS DISTINCT FROM prior_acl THEN
  RAISE EXCEPTION 'tracker_void192_acl_changed';
 END IF;
END $migration$;
COMMIT;
