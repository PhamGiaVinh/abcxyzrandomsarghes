-- CLI candidate20261018151453; forward152. LOCAL ONLY.
-- No result/pricing/ranking changes. Revisions may not reuse an earlier generation.
-- Recovery: suspend hand writes; never restore source-revision rollback capability.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
BEGIN
  IF current_user<>'postgres' OR to_regprocedure('public._tracker_source_revision_monotonic_v1()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000152')
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass
      AND tgname='trg_tracker_hand_source_revision' AND tgenabled='O') THEN
    RAISE EXCEPTION 'tracker152_catalog_drift_or_collision';
  END IF;
END $$;
CREATE FUNCTION public._tracker_source_revision_monotonic_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF NEW.source_revision IS NULL OR NEW.source_revision<COALESCE(OLD.source_revision,1) THEN
    RAISE EXCEPTION 'tracker_source_revision_must_not_decrease' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tracker_source_revision_monotonic_v1() FROM PUBLIC,anon,authenticated,service_role;
-- Sort after the existing identity/source bump triggers, validate their final NEW row.
CREATE TRIGGER zz_tracker_source_revision_monotonic_v1 BEFORE UPDATE ON public.tournament_hands
  FOR EACH ROW EXECUTE FUNCTION public._tracker_source_revision_monotonic_v1();
COMMIT;
