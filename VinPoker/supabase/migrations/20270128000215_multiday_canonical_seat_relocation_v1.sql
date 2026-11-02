-- Forward-only compatibility for canonical post-initial-draw Floor movement.
-- Initial qualification/seating evidence is immutable. No legacy writer grant.
-- Roll out only after exact definition/ACL and runtime qualification.
DO $preflight$
DECLARE r record;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'multiday_seat_move_owner_required'; END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef('private.multi_day_legacy_final_entry_fence_v1()'::regprocedure)) <> '4fe335439be820ce3ac0e9ce79b47f05'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef('public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure)) <> 'd4d372db955d7144efdd9c954b55b1a5'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)'::regprocedure)) <> '37e2a13baad7718380fb6081772e94bf'
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef('floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure)) <> '931316498049756e219eafb39dc739a8'
    OR pg_catalog.to_regclass('private.multi_day_final_seat_moves_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'multiday_seat_move_catalog_precondition';
  END IF;
  FOR r IN SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid IN (
    'private.multi_day_legacy_final_entry_fence_v1()'::regprocedure,
    'public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure,
    'public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)'::regprocedure,
    'floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure)
  LOOP
    IF pg_catalog.pg_get_userbyid(r.proowner)<>'postgres' OR NOT r.prosecdef
      OR r.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR pg_catalog.has_function_privilege('anon',r.oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role',r.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'multiday_seat_move_security_precondition %',r.oid::regprocedure;
    END IF;
  END LOOP;
END
$preflight$;

CREATE TABLE private.multi_day_final_seat_moves_v1 (
  seat_id uuid PRIMARY KEY REFERENCES public.tournament_seats(id) DEFERRABLE INITIALLY DEFERRED,
  source_seat_id uuid NOT NULL UNIQUE REFERENCES public.tournament_seats(id),
  entry_id uuid NOT NULL REFERENCES public.tournament_entries(id),
  participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id),
  source_table_session_id uuid NOT NULL,
  destination_table_session_id uuid NOT NULL,
  destination_tournament_table_id uuid NOT NULL,
  destination_seat_number integer NOT NULL CHECK (destination_seat_number BETWEEN 1 AND 9),
  chip_count bigint NOT NULL CHECK (chip_count > 0),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE private.multi_day_final_seat_moves_v1 OWNER TO postgres;
CREATE INDEX multi_day_final_seat_moves_entry_idx ON private.multi_day_final_seat_moves_v1(entry_id);
CREATE INDEX multi_day_final_seat_moves_participation_idx ON private.multi_day_final_seat_moves_v1(participation_id);
ALTER TABLE private.multi_day_final_seat_moves_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_final_seat_moves_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_final_seat_moves_immutable_v1
  BEFORE UPDATE OR DELETE ON private.multi_day_final_seat_moves_v1
  FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

-- Internal only. Callers already hold tournament -> physical -> session ->
-- entry/seat locks and have deactivated exactly the source seat. Revalidate
-- identity/conservation and create one exact INSERT intent, never a session GUC.
CREATE FUNCTION private.multi_day_prepare_floor_seat_move_v1(
  p_source_seat_id uuid, p_new_seat_id uuid,
  p_destination_tournament_table_id uuid, p_destination_session_id uuid,
  p_destination_seat_number integer, p_stack bigint, p_actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
  v_source public.tournament_seats%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_destination public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_initial public.multi_day_final_seatings_v1%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_source FROM public.tournament_seats WHERE id=p_source_seat_id;
  SELECT * INTO STRICT v_tournament FROM public.tournaments WHERE id=v_source.tournament_id;
  IF v_tournament.phase IS DISTINCT FROM 'final' OR v_tournament.event_id IS NULL THEN RETURN; END IF;
  IF NOT (EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 WHERE event_id=v_tournament.event_id)
    OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 WHERE event_id=v_tournament.event_id)
    OR EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
      JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
        AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_tournament.event_id)) THEN RETURN; END IF;

  IF p_actor IS NULL OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(p_actor,v_tournament.club_id)
    OR v_tournament.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'multi_day_move_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_entry FROM public.tournament_entries WHERE id=v_source.entry_id FOR UPDATE;
  SELECT * INTO v_initial FROM public.multi_day_final_seatings_v1
    WHERE entry_id=v_source.entry_id AND final_tournament_id=v_tournament.id
      AND player_id=v_source.player_id;
  IF v_entry.id IS NULL OR v_initial.entry_id IS NULL
    OR v_entry.status<>'seated' OR v_entry.tournament_id<>v_tournament.id
    OR v_entry.player_id IS DISTINCT FROM v_source.player_id
    OR v_entry.entry_no IS DISTINCT FROM v_source.entry_number
    OR v_entry.seat_id IS DISTINCT FROM v_source.id
    OR v_source.is_active OR v_source.status<>'moved'
    OR p_new_seat_id IS NULL OR p_new_seat_id=v_source.id
    OR p_stack IS NULL OR p_stack<=0
    OR v_source.chip_count IS DISTINCT FROM p_stack
    OR v_entry.current_stack IS DISTINCT FROM p_stack
    OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p
      JOIN public.multi_day_qualification_locks_v1 l ON l.event_id=p.event_id
      WHERE p.id=v_initial.participation_id AND p.event_id=v_tournament.event_id
        AND p.final_tournament_id=v_tournament.id AND p.player_id=v_entry.player_id)
    OR NOT (v_initial.seat_id=v_source.id OR EXISTS(
      SELECT 1 FROM private.multi_day_final_seat_moves_v1 m
      WHERE m.seat_id=v_source.id AND m.entry_id=v_entry.id
        AND m.participation_id=v_initial.participation_id))
    OR EXISTS(SELECT 1 FROM public.tournament_seats s
      WHERE s.tournament_id=v_tournament.id AND s.entry_id=v_entry.id AND s.is_active) THEN
    RAISE EXCEPTION 'multi_day_move_source_identity_changed' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_destination FROM public.tournament_tables
    WHERE id=p_destination_tournament_table_id AND tournament_id=v_tournament.id AND status='active';
  SELECT * INTO v_session FROM public.table_sessions
    WHERE id=p_destination_session_id AND tournament_id=v_tournament.id AND closed_at IS NULL;
  IF v_destination.id IS NULL OR v_session.id IS NULL
    OR v_destination.table_session_id IS DISTINCT FROM v_session.id
    OR v_session.game_table_id IS DISTINCT FROM v_destination.game_table_id
    OR v_session.club_id IS DISTINCT FROM v_tournament.club_id
    OR NOT EXISTS(SELECT 1 FROM public.game_tables gt WHERE gt.id=v_destination.game_table_id AND gt.club_id=v_tournament.club_id)
    OR p_destination_seat_number IS NULL OR p_destination_seat_number<1
    OR p_destination_seat_number>LEAST(v_destination.max_seats,9)
    OR floor_private.floor_table_v3_has_active_hand(v_tournament.id,v_source.tournament_table_id,v_source.table_session_id)
    OR floor_private.floor_table_v3_has_active_hand(v_tournament.id,v_destination.id,v_session.id)
    OR EXISTS(SELECT 1 FROM public.tournament_seats s
      WHERE s.tournament_table_id=v_destination.id AND s.seat_number=p_destination_seat_number AND s.is_active)
    OR EXISTS(SELECT 1 FROM public.table_session_seat_locks l
      WHERE l.table_session_id=v_session.id AND l.seat_number=p_destination_seat_number AND l.unlocked_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves q
      WHERE q.destination_table_session_id=v_session.id AND q.destination_seat_number=p_destination_seat_number
        AND q.status='pending' AND q.entry_id<>v_entry.id) THEN
    RAISE EXCEPTION 'multi_day_move_destination_changed' USING ERRCODE='23514';
  END IF;
  INSERT INTO private.multi_day_final_write_intents_v1(
    transaction_id,backend_pid,kind,row_id,participation_id,row_hash
  ) VALUES(pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),'seat',p_new_seat_id,v_initial.participation_id,
    private.multi_day_final_row_hash_v1('seat',p_new_seat_id,v_tournament.id,v_entry.player_id,
      v_entry.id,p_new_seat_id,v_destination.id,v_session.id,p_destination_seat_number,p_stack));
  INSERT INTO private.multi_day_final_seat_moves_v1(
    seat_id,source_seat_id,entry_id,participation_id,source_table_session_id,
    destination_table_session_id,destination_tournament_table_id,destination_seat_number,chip_count,actor_id
  ) VALUES(p_new_seat_id,v_source.id,v_entry.id,v_initial.participation_id,v_source.table_session_id,
    v_session.id,v_destination.id,p_destination_seat_number,p_stack,p_actor);
END
$fn$;
ALTER FUNCTION private.multi_day_prepare_floor_seat_move_v1(uuid,uuid,uuid,uuid,integer,bigint,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.multi_day_prepare_floor_seat_move_v1(uuid,uuid,uuid,uuid,integer,bigint,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text; old_text text; new_text text; r record; before_acl aclitem[];
BEGIN
  d:=pg_catalog.pg_get_functiondef('private.multi_day_legacy_final_entry_fence_v1()'::regprocedure);
  old_text:=$old$WHERE s.seat_id=OLD.id AND s.final_tournament_id=OLD.tournament_id
             AND s.player_id=OLD.player_id$old$;
  new_text:=$new$WHERE s.entry_id=OLD.entry_id AND s.final_tournament_id=OLD.tournament_id
             AND s.player_id=OLD.player_id
             AND (s.seat_id=OLD.id OR EXISTS(
               SELECT 1 FROM private.multi_day_final_seat_moves_v1 m
               WHERE m.seat_id=OLD.id AND m.entry_id=s.entry_id
                 AND m.participation_id=s.participation_id))$new$;
  IF (pg_catalog.length(d)-pg_catalog.length(pg_catalog.replace(d,old_text,'')))/pg_catalog.length(old_text)<>1 THEN
    RAISE EXCEPTION 'multiday_seat_fence_patch_shape';
  END IF;
  EXECUTE pg_catalog.replace(d,old_text,new_text);

  FOR r IN SELECT * FROM (VALUES
    ('public.floor_break_table_v5(uuid,bigint,uuid,text,text)',
      '      INSERT INTO public.tournament_seats('||chr(10)||'        tournament_id,',
      '      v_new_seat_id:=pg_catalog.gen_random_uuid();'||chr(10)||
      '      PERFORM private.multi_day_prepare_floor_seat_move_v1(v_row.source_seat_id,v_new_seat_id,v_row.destination_tournament_table_id,v_row.destination_table_session_id,v_row.destination_seat_number,v_row.chip_count,v_actor);'||chr(10)||
      '      INSERT INTO public.tournament_seats('||chr(10)||'        id,tournament_id,',
      ') VALUES (v_tournament.id, v_row.player_id,',') VALUES (v_new_seat_id,v_tournament.id, v_row.player_id,'),
    ('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)',
      '    INSERT INTO public.tournament_seats ('||chr(10)||'      tournament_id,',
      '    v_new_seat_id:=pg_catalog.gen_random_uuid();'||chr(10)||
      '    PERFORM private.multi_day_prepare_floor_seat_move_v1(v_source_seat.id,v_new_seat_id,v_destination_table.id,v_destination_session.id,p_to_seat_number,v_source_seat.chip_count,v_actor);'||chr(10)||
      '    INSERT INTO public.tournament_seats ('||chr(10)||'      id,tournament_id,',
      ') VALUES ('||chr(10)||'      v_tournament.id,',') VALUES ('||chr(10)||'      v_new_seat_id,v_tournament.id,'),
    ('floor_private.floor_apply_tracker_moves_after_hand_v1()',
      '      INSERT INTO public.tournament_seats ('||chr(10)||'        tournament_id,',
      '      v_new_seat_id:=pg_catalog.gen_random_uuid();'||chr(10)||
      '      PERFORM private.multi_day_prepare_floor_seat_move_v1(v_seat.id,v_new_seat_id,v_destination.id,v_destination_session.id,v_move.destination_seat_number,v_seat.chip_count,v_move.requested_by);'||chr(10)||
      '      INSERT INTO public.tournament_seats ('||chr(10)||'        id,tournament_id,',
      ') VALUES ('||chr(10)||'        NEW.tournament_id, v_entry.player_id, v_entry.entry_no, v_destination.id,',
      ') VALUES ('||chr(10)||'        v_new_seat_id,NEW.tournament_id, v_entry.player_id, v_entry.entry_no, v_destination.id,')
  ) v(signature,old_insert,new_insert,old_values,new_values)
  LOOP
    d:=pg_catalog.pg_get_functiondef(r.signature::regprocedure);
    SELECT proacl INTO before_acl FROM pg_catalog.pg_proc WHERE oid=r.signature::regprocedure;
    IF (pg_catalog.length(d)-pg_catalog.length(pg_catalog.replace(d,r.old_insert,'')))/pg_catalog.length(r.old_insert)<>1
      OR (pg_catalog.length(d)-pg_catalog.length(pg_catalog.replace(d,r.old_values,'')))/pg_catalog.length(r.old_values)<>1 THEN
      RAISE EXCEPTION 'multiday_floor_writer_patch_shape %',r.signature;
    END IF;
    d:=pg_catalog.replace(pg_catalog.replace(d,r.old_insert,r.new_insert),r.old_values,r.new_values);
    old_text:='RETURNING id INTO v_new_seat_id;';
    IF (pg_catalog.length(d)-pg_catalog.length(pg_catalog.replace(d,old_text,'')))/pg_catalog.length(old_text)<>1 THEN
      RAISE EXCEPTION 'multiday_floor_writer_return_shape %',r.signature;
    END IF;
    EXECUTE pg_catalog.replace(d,old_text,old_text||chr(10)||
      '      DELETE FROM private.multi_day_final_write_intents_v1 WHERE transaction_id=pg_catalog.txid_current() AND backend_pid=pg_catalog.pg_backend_pid() AND kind=''seat'' AND row_id=v_new_seat_id AND consumed;');
    IF (SELECT proacl FROM pg_catalog.pg_proc WHERE oid=r.signature::regprocedure) IS DISTINCT FROM before_acl THEN
      RAISE EXCEPTION 'multiday_floor_writer_acl_changed %',r.signature;
    END IF;
  END LOOP;
END
$patch$;
