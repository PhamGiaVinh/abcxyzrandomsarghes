-- Keep existing integer types/NOT NULL constraints. Validate new/changed VND amounts
-- at the table boundary, not only in selected client/RPC producers.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE FUNCTION floor_private.guard_tournament_fees238() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE field text; value numeric; next_row jsonb:=pg_catalog.to_jsonb(NEW); old_row jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN old_row:=pg_catalog.to_jsonb(OLD);END IF;
 FOREACH field IN ARRAY ARRAY['buy_in','rake_amount','service_fee_amount'] LOOP
  IF TG_OP='UPDATE' AND next_row->field IS NOT DISTINCT FROM old_row->field THEN CONTINUE;END IF;
  value:=(next_row->>field)::numeric;
  IF value IS NOT NULL AND (value<0 OR value>9007199254740991) THEN
   RAISE EXCEPTION 'tournament_money_invalid' USING ERRCODE='23514',DETAIL=field;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.guard_tournament_fees238() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_tournament_fee_integrity238 BEFORE INSERT OR UPDATE OF buy_in,rake_amount,service_fee_amount ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tournament_fees238();
COMMIT;
