-- Archive only terminal tournaments after the existing 24-hour age threshold.
-- A live tournament can run longer than a day; hiding it invalidates open
-- table sessions and blocks Dealer Swing rotation.
-- Existing tombstones are deliberately left untouched. Restoring one requires
-- a separate review of its tables, seats, ledger and public visibility.
-- Rollback: restore the captured pre-apply function definition and grants;
-- do not reverse any deleted_at values written after this migration.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.auto_soft_delete_old_tournaments()') IS NULL THEN
    RAISE EXCEPTION 'auto_soft_delete_old_tournaments missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'auto-soft-delete-old-tournaments'
      AND username = 'postgres' AND active
  ) THEN
    RAISE EXCEPTION 'auto-soft-delete-old-tournaments cron drift';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.auto_soft_delete_old_tournaments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  archived integer := 0;
BEGIN
  WITH updated AS (
    UPDATE public.tournaments t
    SET deleted_at = now(), updated_at = now()
    WHERE t.deleted_at IS NULL
      AND t.status IN ('completed', 'finished', 'cancelled')
      AND t.start_time IS NOT NULL
      AND t.start_time < now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.table_sessions s
        WHERE s.tournament_id = t.id AND s.closed_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO archived FROM updated;
  RETURN archived;
END;
$function$;

-- Cron executes as postgres. A browser must not be able to hide tournaments.
REVOKE ALL ON FUNCTION public.auto_soft_delete_old_tournaments()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
