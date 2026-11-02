-- LOCAL/SOURCE ONLY. CLI candidate20261016222729, forward slot128.
-- Qualified bags may legitimately have no display name. Resolve through their
-- frozen source entry tuple, never the player's current seat in another tour.
-- Recovery: suspend seating and restore pinned127 body with a new migration;
-- preserve all seating, carry stacks, audit and payment history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 target regprocedure:='public.multi_day_seat_final_v1(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text:=$old$ SELECT b.player_name INTO v_name FROM pg_catalog.jsonb_array_elements(v_part.source_bags) x
   JOIN public.chip_bag b ON b.id=(x->>'bagId')::uuid LIMIT 1;$old$;
 replacement text:=$new$ SELECT COALESCE(NULLIF(btrim(b.player_name),''),
     NULLIF(btrim(floor_private.tournament_entry_display_v1(
       e.id,e.player_id,e.tournament_id,e.entry_no)->>'player_name'),'')) INTO v_name
 FROM pg_catalog.jsonb_array_elements(v_part.source_bags) x
 JOIN public.chip_bag b ON b.id=(x->>'bagId')::uuid
 JOIN public.tournament_entries e ON e.id=(x->>'sourceEntryId')::uuid
   AND e.player_id=p_player_id AND e.tournament_id=(x->>'flightId')::uuid
 ORDER BY (x->>'stack')::bigint DESC,b.id LIMIT 1;
 IF v_name IS NULL THEN
   RAISE EXCEPTION 'multi_day_final_display_evidence_missing' USING ERRCODE='23514';
 END IF;$new$;
BEGIN
 IF current_user<>'postgres' OR md5(definition)<>'e62d161729616587f7be6e921ed67963' OR
    to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)') IS NULL THEN
   RAISE EXCEPTION 'multiday128_catalog_drift'; END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'multiday128_anchor_drift'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $patch$;
COMMIT;
