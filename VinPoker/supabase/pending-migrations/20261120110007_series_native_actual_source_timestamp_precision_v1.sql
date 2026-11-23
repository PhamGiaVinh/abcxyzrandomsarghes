-- Local candidate. Reserve a forward ledger slot before release.
-- ROLLBACK: restore the original function definition via a forward migration.
-- Match previous fingerprints for timestamps already aligned to milliseconds.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $migration$
DECLARE
  target regprocedure := 'public.series_promote_native_event_actual_v1(uuid,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  source_column text;
  original text;
  replacement text;
  timestamp_guard text := 'IF v_source_ts IS NULL THEN RAISE EXCEPTION ''native_actual_source_timestamp_unavailable'' USING ERRCODE = ''55000''; END IF;';
  missing_event_timestamp_guard text := 'IF v_event.updated_at IS NULL THEN RAISE EXCEPTION ''series_canonical_timestamp_not_millisecond_exact'' USING ERRCODE = ''22023''; END IF;';
  original_definition text := definition;
  cancelled_guard text := 'IF v_event.status = ''cancelled'' THEN RAISE EXCEPTION ''native_actual_cancelled_event'' USING ERRCODE = ''55000''; END IF;';
  final_scope_guard text := 'IF v_event.phase = ''final'' AND v_event.event_id IS NOT NULL THEN RAISE EXCEPTION ''native_actual_multiday_parent_scope_required'' USING ERRCODE = ''55000''; END IF;';
  changed integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = target AND prosecdef
      AND proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'series_native_actual_function_contract_drift';
  END IF;

  FOREACH source_column IN ARRAY ARRAY['v_event.updated_at', 'tr.updated_at'] LOOP
    original := format('public._series_canonical_timestamptz_v1(%s)', source_column);
    replacement := format(
      'pg_catalog.to_char(%1$s AT TIME ZONE ''UTC'', CASE WHEN %1$s = pg_catalog.date_trunc(''milliseconds'', %1$s) THEN ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'' ELSE ''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'' END)',
      source_column
    );
    IF position(replacement IN definition) > 0 AND position(original IN definition) = 0 THEN
      CONTINUE;
    ELSIF length(definition) - length(replace(definition, original, '')) = length(original)
        AND position(replacement IN definition) = 0 THEN
      definition := replace(definition, original, replacement);
      changed := changed + 1;
    ELSE
      RAISE EXCEPTION 'series_native_actual_source_timestamp_precision_drift';
    END IF;
  END LOOP;

  IF changed NOT IN (0, 2) THEN
    RAISE EXCEPTION 'series_native_actual_source_timestamp_partial_drift';
  END IF;
  IF length(definition) - length(replace(definition, timestamp_guard, '')) <> length(timestamp_guard) THEN
    RAISE EXCEPTION 'series_native_actual_source_timestamp_guard_drift';
  END IF;
  IF position(missing_event_timestamp_guard IN definition) = 0 THEN
    definition := replace(definition, timestamp_guard, timestamp_guard || chr(10) || '  ' || missing_event_timestamp_guard);

  ELSIF changed = 2 THEN
    RAISE EXCEPTION 'series_native_actual_source_timestamp_partial_drift';
  END IF;
  IF length(definition) - length(replace(definition, cancelled_guard, '')) <> length(cancelled_guard) THEN
    RAISE EXCEPTION 'series_native_actual_final_scope_guard_drift';
  END IF;
  IF position(final_scope_guard IN definition) = 0 THEN
    definition := replace(definition, cancelled_guard, cancelled_guard || chr(10) || '  ' || final_scope_guard);
  END IF;
  IF definition <> original_definition THEN
    EXECUTE definition;
  END IF;
END;
$migration$;

COMMIT;
