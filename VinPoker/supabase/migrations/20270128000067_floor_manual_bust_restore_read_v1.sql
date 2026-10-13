-- CLI-generated candidate promoted to unused forward catalog67 after source/live checks.
-- Manual participants have canonical entries but intentionally no registration.
-- Restore remains evidence-bound; no stack, receipt, payout or writer changes.
-- ROLLBACK: forward restore this pinned reader body and hide manual restore UI.
-- Preserve entries, seats, chip projections and audit; never fabricate registration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $manual_restore_read$
DECLARE f regprocedure:='public.get_floor_restorable_entries_v3(uuid)'::regprocedure;
 body text; old_filter text; new_filter text; old_display text; new_display text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=f
   AND md5(replace(p.prosrc,chr(13),''))='f9b32df63f6d9aa627aa5fbbd2d92d70'
   AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
   AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}') THEN
   RAISE EXCEPTION 'manual_restore_reader_definition_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)')
   AND md5(replace(p.prosrc,chr(13),''))='1fa4fcae06f56774b40913b83a6b239a'
   AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'manual_restore_display_dependency_drift'; END IF;
 body:=replace(pg_get_functiondef(f),chr(13),'');
 old_filter:='AND e.registration_id IS NOT NULL';
 new_filter:=$new$AND (e.registration_id IS NOT NULL OR e.source='manual')$new$;
 old_display:=$old$COALESCE(NULLIF(p.display_name,''),e.player_id::text)$old$;
 new_display:=$new$COALESCE(NULLIF(pg_catalog.btrim(p.display_name),''),
    floor_private.tournament_entry_display_v1(e.id,e.player_id,e.tournament_id,e.entry_no)->>'player_name',e.player_id::text)$new$;
 IF length(body)-length(replace(body,old_filter,''))<>length(old_filter)
   OR length(body)-length(replace(body,old_display,''))<>length(old_display) THEN
   RAISE EXCEPTION 'manual_restore_reader_patch_not_unique'; END IF;
 EXECUTE replace(replace(body,old_filter,new_filter),old_display,new_display);
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=f
   AND md5(replace(p.prosrc,chr(13),''))='6b2e72c175318f2f91a1a0b55966a1db'
   AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
   AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}'
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'manual_restore_reader_postcheck_failed'; END IF;
END $manual_restore_read$;
COMMIT;
