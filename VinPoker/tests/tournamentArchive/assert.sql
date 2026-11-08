DO $test$
DECLARE
  archived integer;
BEGIN
  IF has_function_privilege('authenticated', 'public.auto_soft_delete_old_tournaments()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.auto_soft_delete_old_tournaments()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.auto_soft_delete_old_tournaments()', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser/service roles can invoke archive';
  END IF;

  archived := public.auto_soft_delete_old_tournaments();
  IF archived <> 2 THEN RAISE EXCEPTION 'expected two terminal closed tours, got %', archived; END IF;
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE id IN (1,2,4,5,6) AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'active, open-table, young, or null-start tour archived';
  END IF;
  IF (SELECT count(*) FROM public.tournaments WHERE id IN (3,7) AND deleted_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'closed terminal tours not archived';
  END IF;
  IF public.auto_soft_delete_old_tournaments() <> 0 THEN
    RAISE EXCEPTION 'archive retry not idempotent';
  END IF;
END $test$;

UPDATE public.table_sessions SET closed_at=now() WHERE id=2;
DO $test$
DECLARE archived integer;
BEGIN
  archived := public.auto_soft_delete_old_tournaments();
  IF archived <> 1 OR (SELECT deleted_at FROM public.tournaments WHERE id=4) IS NULL THEN
    RAISE EXCEPTION 'terminal tour not archived after last table closes';
  END IF;
END $test$;
