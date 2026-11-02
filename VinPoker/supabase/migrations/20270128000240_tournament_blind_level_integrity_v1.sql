-- Match existing editor validation, not a new progression/rounding policy.
-- Preserve existing integer/NOT NULL types and unchanged legacy values.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION floor_private.guard_tournament_blinds240() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE field text; next_row jsonb:=pg_catalog.to_jsonb(NEW); old_row jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN old_row:=pg_catalog.to_jsonb(OLD);END IF;
 FOREACH field IN ARRAY ARRAY['small_blind','big_blind','ante','duration_minutes'] LOOP
  IF TG_OP='UPDATE' AND next_row->field IS NOT DISTINCT FROM old_row->field THEN CONTINUE;END IF;
  IF (next_row->>field)::integer<0 THEN
   RAISE EXCEPTION 'tournament_blind_level_invalid' USING ERRCODE='23514',DETAIL=field;
  END IF;
 END LOOP;
 IF NOT NEW.is_break AND NEW.big_blind<=0 THEN
  IF TG_OP='INSERT' THEN
   RAISE EXCEPTION 'tournament_blind_level_invalid' USING ERRCODE='23514',DETAIL='big_blind';
  ELSIF NEW.big_blind IS DISTINCT FROM OLD.big_blind OR NEW.is_break IS DISTINCT FROM OLD.is_break THEN
   RAISE EXCEPTION 'tournament_blind_level_invalid' USING ERRCODE='23514',DETAIL='big_blind';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.guard_tournament_blinds240() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_tournament_blind_integrity240 BEFORE INSERT OR UPDATE OF small_blind,big_blind,ante,duration_minutes,is_break ON public.tournament_levels
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tournament_blinds240();
COMMIT;
