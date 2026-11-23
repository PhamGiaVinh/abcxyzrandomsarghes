-- Local candidate. Reserve a forward ledger slot before release.
-- ROLLBACK: restore the original frozenAt expression in a forward migration.
-- Stored timestamps, packet hashes and the strict canonicalizer stay intact.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $migration$
DECLARE
  target regprocedure := 'public.series_get_decision_event_state_v1(uuid)'::regprocedure;
  definition text := pg_get_functiondef(target);
  original text := 'public._series_canonical_timestamptz_v1(p.frozen_at)';
  replacement text := 'public._series_canonical_timestamptz_v1(pg_catalog.date_trunc(''milliseconds'', p.frozen_at))';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = target AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'series_decision_room_reader_contract_drift';
  END IF;

  IF position(replacement IN definition) > 0 AND position(original IN definition) = 0 THEN
    RETURN;
  END IF;
  IF length(definition) - length(replace(definition, original, '')) <> length(original)
      OR position(replacement IN definition) > 0 THEN
    RAISE EXCEPTION 'series_decision_room_frozen_timestamp_projection_drift';
  END IF;

  EXECUTE replace(definition, original, replacement);
END;
$migration$;

COMMIT;
