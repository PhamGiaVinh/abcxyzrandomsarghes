-- CLI candidate20261018115422, forward143. LOCAL ONLY, NOT LIVE.
-- Qualified D2 participation is not a second registration. Preserve identity,
-- stack and frozen seed receipt; reuse its canonical seat row on reseating.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION floor_private.is_qualified_final_entry_v1(p_entry_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.tournament_entries e
  JOIN public.tournaments t ON t.id=e.tournament_id AND t.phase='final'
  JOIN public.tournament_events ev ON ev.id=t.event_id AND ev.final_tournament_id=t.id AND ev.club_id=t.club_id
  JOIN public.multi_day_qualification_rules_v1 r ON r.event_id=ev.id AND r.final_tournament_id=t.id AND r.club_id=t.club_id
  JOIN public.multi_day_qualification_locks_v1 q ON q.event_id=ev.id
  JOIN public.multi_day_final_participations_v1 p ON p.event_id=ev.id AND p.final_tournament_id=t.id AND p.player_id=e.player_id
  JOIN public.multi_day_final_seatings_v1 s ON s.participation_id=p.id AND s.entry_id=e.id
   AND s.final_tournament_id=t.id AND s.player_id=e.player_id AND s.source_hash=q.source_hash AND s.source_bags=p.source_bags
  WHERE e.id=p_entry_id AND e.registration_id IS NULL AND e.source='staff' AND e.entry_no=1
 );
$$;
REVOKE ALL ON FUNCTION floor_private.is_qualified_final_entry_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE r record; target regprocedure; body text; definition text; acl aclitem[];
 start_anchor text:='    INSERT INTO public.tournament_seats (';
 end_anchor text:='    RETURNING id INTO v_seat_id;';
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.floor_free_sit_player_v1(uuid,bigint,bigint,integer,uuid,text)','1951430bc0b8d0ff57d087a28b6a25dd',
  $old$v_entry.registration_id IS NULL AND v_entry.source IS DISTINCT FROM 'manual'$old$,
  $new$v_entry.registration_id IS NULL AND v_entry.source IS DISTINCT FROM 'manual'
    AND NOT floor_private.is_qualified_final_entry_v1(v_entry.id)$new$),
 ('public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)','58d0372f88bc4a694182219bab178fe1',
  $old$v_entry.registration_id IS NULL AND v_entry.source IS DISTINCT FROM 'manual'$old$,
  $new$v_entry.registration_id IS NULL AND v_entry.source IS DISTINCT FROM 'manual'
    AND NOT floor_private.is_qualified_final_entry_v1(v_entry.id)$new$),
 ('public.get_floor_seatable_entries(uuid)','b9ca01c5183bf6cd93f7519d7e970011',
  $old$entry_row.registration_id IS NOT NULL OR entry_row.source = 'manual'$old$,
  $new$entry_row.registration_id IS NOT NULL OR entry_row.source = 'manual'
    OR floor_private.is_qualified_final_entry_v1(entry_row.id)$new$)
 ) x(signature,digest,needle,replacement)
 LOOP
  target:=r.signature::regprocedure;
  SELECT replace(prosrc,chr(13),''),proacl INTO body,acl FROM pg_proc WHERE oid=target
   AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""'];
  IF current_user<>'postgres' OR body IS NULL OR md5(body)<>r.digest
   OR length(body)-length(replace(body,r.needle,''))<>length(r.needle) THEN
   RAISE EXCEPTION 'd2_roundtrip143_dependency_drift: %',r.signature; END IF;
  definition:=replace(pg_get_functiondef(target),chr(13),'');
  definition:=replace(definition,r.needle,r.replacement);
  IF r.signature LIKE 'public.floor_assign_entry_to_seat(%' THEN
   IF length(definition)-length(replace(definition,start_anchor,''))<>length(start_anchor)
    OR length(definition)-length(replace(definition,end_anchor,''))<>length(end_anchor) THEN
    RAISE EXCEPTION 'd2_roundtrip143_seat_anchor_drift'; END IF;
   definition:=replace(definition,start_anchor,$branch$    IF floor_private.is_qualified_final_entry_v1(v_entry.id) THEN
      UPDATE public.tournament_seats seat_row
      SET table_id=v_tournament_table.id,tournament_table_id=v_tournament_table.id,
          table_session_id=v_session.id,seat_number=p_seat_number,
          chip_count=v_entry.current_stack,is_active=true,status='active',
          assigned_by=v_actor,assigned_at=pg_catalog.now()
      WHERE seat_row.id=(SELECT seed.seat_id FROM public.multi_day_final_seatings_v1 seed WHERE seed.entry_id=v_entry.id)
        AND seat_row.entry_id=v_entry.id AND seat_row.tournament_id=v_tournament.id
        AND seat_row.player_id=v_entry.player_id AND seat_row.entry_number=v_entry.entry_no
        AND NOT seat_row.is_active
      RETURNING seat_row.id INTO v_seat_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'qualified_final_seat_evidence_missing'; END IF;
    ELSE
$branch$||start_anchor);
   definition:=replace(definition,end_anchor,end_anchor||E'\n    END IF;');
  END IF;
  EXECUTE definition;
  IF (SELECT proacl FROM pg_proc WHERE oid=target) IS DISTINCT FROM acl THEN RAISE EXCEPTION 'd2_roundtrip143_acl_drift'; END IF;
 END LOOP;
END $patch$;
COMMIT;
