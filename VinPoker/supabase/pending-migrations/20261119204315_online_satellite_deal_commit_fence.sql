-- Pending G03. Apply only after the private satellite clock and level schema.
-- Pause/resume and any future schedule writer must lock table_clocks first.
-- The fence is used only on hand creation. Settling a hand keeps its original level.
BEGIN;

ALTER TABLE public.online_poker_hands
  ADD COLUMN IF NOT EXISTS satellite_deal_level jsonb;

CREATE FUNCTION public.op_check_satellite_deal_level()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  clock_row online_satellite_private.table_clocks%ROWTYPE;
  level_row online_satellite_private.blind_levels%ROWTYPE;
  deal_time timestamptz;
  config jsonb := NEW.state->'config';
  expected jsonb := NEW.state->'satelliteLevel';
BEGIN
  SELECT c.* INTO clock_row FROM online_satellite_private.table_clocks c
    WHERE c.table_id = NEW.table_id FOR SHARE;
  IF NOT FOUND THEN
    IF expected IS NOT NULL THEN
      RAISE EXCEPTION 'online_satellite_deal_not_bound' USING ERRCODE = '23514';
    END IF;
    NEW.satellite_deal_level := NULL;
    RETURN NEW;
  END IF;

  deal_time := pg_catalog.clock_timestamp();
  IF clock_row.running_since IS NULL OR deal_time < clock_row.running_since THEN
    RAISE EXCEPTION 'online_satellite_clock_not_running' USING ERRCODE = '23514';
  END IF;
  SELECT l.* INTO level_row FROM online_satellite_private.blind_levels l
    WHERE l.pilot_id = clock_row.pilot_id
      AND l.starts_at_second <= clock_row.elapsed_seconds
        + extract(epoch FROM deal_time - clock_row.running_since)
    ORDER BY l.starts_at_second DESC LIMIT 1;
  IF NOT FOUND OR expected IS DISTINCT FROM jsonb_build_object(
      'clockRevision', clock_row.revision::text, 'levelStartSecond', level_row.starts_at_second::text)
    OR (config->>'sb')::bigint IS DISTINCT FROM level_row.small_blind
    OR (config->>'bb')::bigint IS DISTINCT FROM level_row.big_blind
    OR COALESCE((config->>'bigBlindAnte')::bigint, 0) IS DISTINCT FROM level_row.big_blind_ante THEN
    RAISE EXCEPTION 'online_satellite_stale_deal_level' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM online_satellite_private.pilots p JOIN public.online_poker_tables t
      ON t.id = NEW.table_id AND t.club_id = p.club_id
    WHERE p.id = clock_row.pilot_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.state->'seats') s
    WHERE NOT EXISTS (
      SELECT 1 FROM online_satellite_private.entries e WHERE e.pilot_id = clock_row.pilot_id
        AND e.player_user_id = (s->>'playerId')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'online_satellite_deal_roster_invalid' USING ERRCODE = '23514';
  END IF;
  NEW.satellite_deal_level := jsonb_build_object(
    'clockRevision', clock_row.revision::text,
    'levelStartSecond', level_row.starts_at_second::text,
    'sb', level_row.small_blind::text,
    'bb', level_row.big_blind::text,
    'bigBlindAnte', level_row.big_blind_ante::text
  );
  NEW.state := NEW.state - 'satelliteLevel';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.op_check_satellite_deal_level() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_op_check_satellite_deal_level
  BEFORE INSERT ON public.online_poker_hands
  FOR EACH ROW EXECUTE FUNCTION public.op_check_satellite_deal_level();

COMMIT;
