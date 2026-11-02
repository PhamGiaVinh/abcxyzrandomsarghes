-- Validate only new/changed counts; do not rewrite historical counters or
-- constrain legitimate NULL (unknown) values, derived counts or other fields.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION floor_private.guard_tournament_players239() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.current_players IS NOT DISTINCT FROM OLD.current_players THEN RETURN NEW; END IF;
 END IF;
 IF NEW.current_players IS NOT NULL AND NEW.current_players<0 THEN
  RAISE EXCEPTION 'tournament_player_count_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.guard_tournament_players239() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_tournament_players_integrity239 BEFORE INSERT OR UPDATE OF current_players ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tournament_players239();
COMMIT;
