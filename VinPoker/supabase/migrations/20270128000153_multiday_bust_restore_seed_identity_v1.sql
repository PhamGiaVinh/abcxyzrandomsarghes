-- CLI candidate20261018160240; reserved forward153, LOCAL ONLY / NOT LIVE.
-- Restore the same qualified D2 participation and seed seat, not a new buy-in.
-- Recovery: suspend restore wrappers in a forward release if necessary; restore
-- reviewed pre-apply function bodies/ACL. Preserve entries, receipts and audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE reader regprocedure:='public.get_floor_restorable_entries_v3(uuid)'::regprocedure;
 writer regprocedure:='floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure;
 fn regprocedure; expected text; body text; definition text; acl aclitem[];
 start_anchor text:='    INSERT INTO public.tournament_seats (';
 end_anchor text:='    RETURNING id INTO v_new_seat_id;';
BEGIN
 IF current_user<>'postgres' OR to_regprocedure('floor_private.is_qualified_final_entry_v1(uuid)') IS NULL THEN
  RAISE EXCEPTION 'd2_restore153_dependency_missing';END IF;
 FOREACH fn IN ARRAY ARRAY[reader,writer] LOOP
  expected:=CASE WHEN fn=reader THEN '6b2e72c175318f2f91a1a0b55966a1db' ELSE '5842ae2485a2a151b86c43cc0cda1ef4' END;
  SELECT replace(prosrc,chr(13),''),proacl INTO body,acl FROM pg_proc WHERE oid=fn
    AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""'];
  IF body IS NULL OR md5(body)<>expected THEN RAISE EXCEPTION 'd2_restore153_definition_drift: %',fn;END IF;
  definition:=replace(pg_get_functiondef(fn),chr(13),'');
  IF fn=reader THEN
   IF length(definition)-length(replace(definition,'(e.registration_id IS NOT NULL OR e.source=''manual'')',''))
     <>length('(e.registration_id IS NOT NULL OR e.source=''manual'')') THEN RAISE EXCEPTION 'd2_restore153_read_anchor';END IF;
   definition:=replace(definition,'(e.registration_id IS NOT NULL OR e.source=''manual'')',
     '(e.registration_id IS NOT NULL OR e.source=''manual'' OR floor_private.is_qualified_final_entry_v1(e.id))');
  ELSE
   IF length(definition)-length(replace(definition,start_anchor,''))<>length(start_anchor)
    OR length(definition)-length(replace(definition,end_anchor,''))<>length(end_anchor) THEN
    RAISE EXCEPTION 'd2_restore153_writer_anchor';END IF;
   definition:=replace(definition,start_anchor,$branch$    IF floor_private.is_qualified_final_entry_v1(v_entry.id) THEN
      UPDATE public.tournament_seats s
      SET table_id=v_destination_table.id,tournament_table_id=v_destination_table.id,
          table_session_id=v_destination_session.id,seat_number=p_to_seat_number,
          chip_count=v_stack,is_active=true,status='active',assigned_by=v_actor,assigned_at=pg_catalog.now()
      WHERE s.id=v_busted_seat.id AND s.entry_id=v_entry.id AND NOT s.is_active AND s.status='busted'
        AND EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 seed
          WHERE seed.entry_id=v_entry.id AND seed.seat_id=s.id AND seed.final_tournament_id=v_tournament.id
            AND seed.player_id=v_entry.player_id)
      RETURNING s.id INTO v_new_seat_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'qualified_final_restore_seat_evidence_missing';END IF;
    ELSE
$branch$||start_anchor);
   definition:=replace(definition,end_anchor,end_anchor||E'\n    END IF;');
  END IF;
  EXECUTE definition;
  IF (SELECT proacl FROM pg_proc WHERE oid=fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'd2_restore153_acl_drift';END IF;
 END LOOP;
 IF has_function_privilege('authenticated',writer,'EXECUTE') OR has_function_privilege('anon',writer,'EXECUTE')
 OR NOT has_function_privilege('authenticated',reader,'EXECUTE') OR has_function_privilege('anon',reader,'EXECUTE')
 OR has_function_privilege('service_role',reader,'EXECUTE') THEN RAISE EXCEPTION 'd2_restore153_privilege_postcheck';END IF;
END $patch$;
COMMIT;
