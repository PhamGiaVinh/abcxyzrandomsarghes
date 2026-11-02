-- Match the existing canonical create contract at every GTD write boundary.
-- NULL means unspecified; do not rewrite historical values or block unrelated
-- updates to legacy rows whose guarantee is unchanged.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION floor_private.guard_tournament_guarantee237() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.guarantee_amount IS NOT DISTINCT FROM OLD.guarantee_amount THEN RETURN NEW;END IF;
 IF NEW.guarantee_amount IS NOT NULL AND
  (NEW.guarantee_amount<0 OR NEW.guarantee_amount>9007199254740991
   OR NEW.guarantee_amount<>pg_catalog.trunc(NEW.guarantee_amount)) THEN
  RAISE EXCEPTION 'tournament_guarantee_invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.guard_tournament_guarantee237() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_tournament_guarantee_integrity237 BEFORE INSERT OR UPDATE OF guarantee_amount ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tournament_guarantee237();
COMMIT;
