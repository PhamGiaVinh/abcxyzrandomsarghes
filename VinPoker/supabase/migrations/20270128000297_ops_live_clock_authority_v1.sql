-- Business write boundary only. Preserve the existing function identity,
-- authorization, role grants, state transition policy and terminal guards.
-- Levels/timing use the existing revision-checked Floor clock controls.
-- Rollback rehearsal: execute in a transaction and ROLLBACK (see config1003).
DO $migration$
DECLARE
  definition text;
  anchor text := E'  UPDATE public.tournaments\n  SET status = p_status,';
  previous_write text := E'      players_remaining = p_players_remaining, current_level = p_level,\n      current_blinds = p_blinds, updated_at = now()';
  next_write text := E'      players_remaining = p_players_remaining, updated_at = now()';
BEGIN
  SELECT replace(pg_get_functiondef('public.ops_update_tournament_live(uuid,text,integer,integer,text,text)'::regprocedure),chr(13),'') INTO definition;
  IF md5(definition)='5f9825d3cda43cdbb5861e8007177455' THEN RETURN; END IF;
  IF md5(definition)<>'73569e2ce7904d3708cbb278ec558aea'
    OR position(anchor IN definition)=0 OR position(previous_write IN definition)=0 THEN
    RAISE EXCEPTION 'ops_live_clock_authority_baseline_mismatch';
  END IF;
  definition:=replace(definition,anchor,
    E'  IF p_level IS DISTINCT FROM v_tour.current_level THEN\n    RETURN jsonb_build_object(''ok'',false,''error'',''clock_level_control_required'');\n  END IF;\n\n'||anchor);
  definition:=replace(definition,previous_write,next_write);
  EXECUTE definition;
END;
$migration$;
