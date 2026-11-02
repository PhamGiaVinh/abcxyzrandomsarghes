-- CLI candidate 20261018083511; forward139 absent from the local source catalog.
-- Initialize only NEW paid entry generations. No backfill or inventory issuance.
-- Recovery: suspend confirmation writers; forward restore reviewed definitions.
-- Never remove projections or rewrite existing entry/chip/payment history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 target regprocedure; before_row pg_proc%ROWTYPE; original text; patched text;
 definition text; anchor text; replacement text;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.confirm_registration_and_assign_seat(uuid,uuid,text)'::regprocedure,
  'public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure
 ] LOOP
  SELECT * INTO before_row FROM pg_proc WHERE oid=target;
  original:=replace(before_row.prosrc,chr(13),'');patched:=original;
  IF before_row.proowner<>'postgres'::regrole OR NOT before_row.prosecdef
    OR before_row.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[] THEN
   RAISE EXCEPTION 'paid_projection139_authority_drift: %',target;
  END IF;
  IF target='public.confirm_registration_and_assign_seat(uuid,uuid,text)'::regprocedure THEN
   IF md5(original)<>'56eeb055a85b3a0265a4b3278c0b0db9'
     OR before_row.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'paid_projection139_initial_baseline_drift';
   END IF;
   anchor:='  -- 11. Create the entry (seated).';
   replacement:=E'  -- An orphan projection is evidence to review, not a value to overwrite.\n'
    ||E'  IF EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id=v_reg.tournament_id\n'
    ||E'    AND player_id=v_reg.player_id AND entry_number=v_entry_no) THEN\n'
    ||E'    RETURN jsonb_build_object(''ok'',false,''error'',''stack_projection_generation_conflict'');\n'
    ||E'  END IF;\n\n'||anchor;
   IF position(anchor IN patched)=0 OR array_length(string_to_array(patched,anchor),1)<>2 THEN
    RAISE EXCEPTION 'paid_projection139_initial_guard_anchor_drift';END IF;
   patched:=replace(patched,anchor,replacement);
   anchor:='  -- 14. Confirm the registration.';
   replacement:=E'  -- Match the exact entry generation before publication/receipt in this transaction.\n'
    ||E'  INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)\n'
    ||E'  VALUES(v_reg.tournament_id,v_reg.player_id,v_entry_no,v_starting_stack);\n\n'||anchor;
   IF position(anchor IN patched)=0 OR array_length(string_to_array(patched,anchor),1)<>2 THEN
    RAISE EXCEPTION 'paid_projection139_initial_insert_anchor_drift';END IF;
   patched:=replace(patched,anchor,replacement);
  ELSE
   IF md5(original)<>'e75f406e841c90e2eb4d64a9f01fd774'
     OR before_row.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
    RAISE EXCEPTION 'paid_projection139_reentry_baseline_drift';
   END IF;
   anchor:=E'  BEGIN\n    INSERT INTO public.tournament_seats (';
   replacement:=E'  IF EXISTS(SELECT 1 FROM public.tournament_chip_counts WHERE tournament_id=p_tournament_id\n'
    ||E'    AND player_id=p_player_id AND entry_number=v_entry_no) THEN\n'
    ||E'    RETURN jsonb_build_object(''ok'',false,''error'',''stack_projection_generation_conflict'');\n'
    ||E'  END IF;\n\n'||anchor;
   IF position(anchor IN patched)=0 OR array_length(string_to_array(patched,anchor),1)<>2 THEN
    RAISE EXCEPTION 'paid_projection139_reentry_guard_anchor_drift';END IF;
   patched:=replace(patched,anchor,replacement);
   anchor:=E'  )\n  ON CONFLICT (tournament_id, player_id, entry_number)\n  DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();';
   IF position(anchor IN patched)=0 OR array_length(string_to_array(patched,anchor),1)<>2 THEN
    RAISE EXCEPTION 'paid_projection139_reentry_upsert_anchor_drift';END IF;
   patched:=replace(patched,anchor,'  );');
  END IF;
  definition:=replace(pg_get_functiondef(target),chr(13),'');
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'paid_projection139_definition_drift';END IF;
  EXECUTE replace(definition,original,patched);
  IF (SELECT replace(prosrc,chr(13),'') FROM pg_proc WHERE oid=target) IS DISTINCT FROM patched
    OR (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM before_row.proacl THEN
   RAISE EXCEPTION 'paid_projection139_postcheck_failed: %',target;
  END IF;
 END LOOP;
END $patch$;
COMMIT;
