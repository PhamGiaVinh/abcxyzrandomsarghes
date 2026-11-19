-- Pending. Provision the new table and registered roster before inserting
-- its immutable clock binding, all in one transaction. Settlement can update
-- a funded stack; practice wallet writers cannot change the roster or rebuy.
BEGIN;

CREATE FUNCTION public.op_guard_satellite_seat()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  source_bound boolean := false;
  target_bound boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT EXISTS (SELECT 1 FROM online_satellite_private.table_clocks WHERE table_id=OLD.table_id)
      OR EXISTS (SELECT 1 FROM public.online_poker_tables WHERE id=OLD.table_id AND is_satellite)
    INTO source_bound;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT EXISTS (SELECT 1 FROM online_satellite_private.table_clocks WHERE table_id=NEW.table_id)
      OR EXISTS (SELECT 1 FROM public.online_poker_tables WHERE id=NEW.table_id AND is_satellite)
    INTO target_bound;
  END IF;
  IF source_bound OR target_bound THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'online_satellite_roster_is_fixed' USING ERRCODE='23514';
    END IF;
    IF OLD.table_id IS DISTINCT FROM NEW.table_id OR OLD.seat_no IS DISTINCT FROM NEW.seat_no
       OR OLD.user_id IS DISTINCT FROM NEW.user_id OR (OLD.stack = 0 AND NEW.stack > 0) THEN
      RAISE EXCEPTION 'online_satellite_roster_is_fixed' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION online_satellite_private.keep_table_clock_binding()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'online_satellite_table_binding_is_fixed' USING ERRCODE='23514';
  END IF;
  IF OLD.table_id IS DISTINCT FROM NEW.table_id OR OLD.pilot_id IS DISTINCT FROM NEW.pilot_id
    OR OLD.qualification_slots IS DISTINCT FROM NEW.qualification_slots THEN
    RAISE EXCEPTION 'online_satellite_table_binding_is_fixed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.op_guard_satellite_seat() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION online_satellite_private.keep_table_clock_binding() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_op_guard_satellite_seat
  BEFORE INSERT OR UPDATE OF table_id, seat_no, user_id, stack OR DELETE ON public.online_poker_seats
  FOR EACH ROW EXECUTE FUNCTION public.op_guard_satellite_seat();
CREATE TRIGGER trg_keep_satellite_table_clock_binding
  BEFORE UPDATE OF table_id, pilot_id, qualification_slots OR DELETE ON online_satellite_private.table_clocks
  FOR EACH ROW EXECUTE FUNCTION online_satellite_private.keep_table_clock_binding();

COMMIT;
