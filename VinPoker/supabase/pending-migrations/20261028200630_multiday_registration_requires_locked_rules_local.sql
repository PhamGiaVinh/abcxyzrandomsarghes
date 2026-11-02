-- LOCAL CANDIDATE ONLY. Depends on 20270120000002 and its release/rules tables.
-- CLI timestamp predates those dependencies: do not promote/replay by filename.
-- Forward replacement plus entry fence; no historical rows, grants or existing
-- trigger bindings changed.
-- Rollback: drop multi_day_entry_rules_fence_v1 on tournament_entries, then
-- restore the prior private.multi_day_registration_event_fence_v1
-- definition from 20270120000002. Never remove/alter existing registration rows.
-- Guarded local rehearsal: pending-tests/multiday_registration_rules_rollback.local.sql.
BEGIN;
CREATE OR REPLACE FUNCTION private.multi_day_registration_event_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid;
BEGIN
 SELECT t.event_id INTO v_event FROM public.tournaments t
  WHERE t.id=NEW.tournament_id AND t.phase='flight';
 IF v_event IS NOT NULL AND EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     JOIN public.tournament_events e ON e.id=v_event AND e.club_id=ANY(g.allowed_club_ids)
     WHERE g.id AND g.enabled) THEN
   -- Same lock/order as the existing fence: rules takes the event FOR UPDATE.
   PERFORM 1 FROM public.tournament_events e WHERE e.id=v_event FOR SHARE;
   -- Reject a NEW registration before its price/bag policy can become unfixable.
   -- Do not block status/payment updates of historical registrations.
   IF (TG_OP='INSERT' OR NEW.tournament_id IS DISTINCT FROM OLD.tournament_id)
      AND NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
        WHERE r.event_id=v_event) THEN
     IF TG_TABLE_NAME='tournament_entries' THEN
       RAISE EXCEPTION 'multi_day_rules_required_before_entry' USING ERRCODE='23514';
     END IF;
     RAISE EXCEPTION 'multi_day_rules_required_before_registration' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
-- Walk-in/manual writers can insert entries without an app registration.
-- Reuse the same event lock and policy at that database boundary as well.
CREATE TRIGGER multi_day_entry_rules_fence_v1
 BEFORE INSERT OR UPDATE OF tournament_id ON public.tournament_entries
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_registration_event_fence_v1();
COMMIT;
