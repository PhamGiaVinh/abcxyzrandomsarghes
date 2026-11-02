-- LOCAL rollback rehearsal only; exact owned race clone, no business rows changed.
-- Restore the original canonical pending002 definition, preserving its OID/ACL.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_rules_race_20261029';
 ASSERT inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RULES_RACE_20261029_OWNED_LOCAL_TEST';
 ASSERT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='multi_day_entry_rules_fence_v1' AND tgrelid='public.tournament_entries'::regclass);
END $$;
DROP TRIGGER multi_day_entry_rules_fence_v1 ON public.tournament_entries;
CREATE OR REPLACE FUNCTION private.multi_day_registration_event_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid;
BEGIN
 SELECT t.event_id INTO v_event FROM public.tournaments t
  WHERE t.id=NEW.tournament_id AND t.phase='flight';
 IF v_event IS NOT NULL AND EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     JOIN public.tournament_events e ON e.id=v_event AND e.club_id=ANY(g.allowed_club_ids)
     WHERE g.id AND g.enabled) THEN
   PERFORM 1 FROM public.tournament_events e WHERE e.id=v_event FOR SHARE;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
