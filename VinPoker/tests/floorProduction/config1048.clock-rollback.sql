-- LOCAL review artifact: guarded rollback of business clock patch297 only.
-- No authorization, ownership, grant, RLS or business-data changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $rollback297$
DECLARE
 definition text;
 injected_guard text := E'  IF p_level IS DISTINCT FROM v_tour.current_level THEN\n    RETURN jsonb_build_object(''ok'',false,''error'',''clock_level_control_required'');\n  END IF;\n\n';
 old_write text := E'      players_remaining = p_players_remaining, current_level = p_level,\n      current_blinds = p_blinds, updated_at = now()';
 new_write text := E'      players_remaining = p_players_remaining, updated_at = now()';
BEGIN
 SELECT replace(pg_get_functiondef('public.ops_update_tournament_live(uuid,text,integer,integer,text,text)'::regprocedure),chr(13),'') INTO definition;
 IF md5(definition)<>'5f9825d3cda43cdbb5861e8007177455' THEN
  RAISE EXCEPTION 'clock297_rollback_candidate_mismatch';
 END IF;
 definition:=replace(definition,injected_guard,'');
 definition:=replace(definition,new_write,old_write);
 IF md5(definition)<>'73569e2ce7904d3708cbb278ec558aea' THEN
  RAISE EXCEPTION 'clock297_rollback_baseline_mismatch';
 END IF;
 EXECUTE definition;
 IF md5(replace(pg_get_functiondef('public.ops_update_tournament_live(uuid,text,integer,integer,text,text)'::regprocedure),chr(13),''))<>'73569e2ce7904d3708cbb278ec558aea' THEN
  RAISE EXCEPTION 'clock297_rollback_postcondition_mismatch';
 END IF;
END;
$rollback297$;
COMMIT;
