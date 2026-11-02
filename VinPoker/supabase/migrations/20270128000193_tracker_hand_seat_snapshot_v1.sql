-- Forward-only candidate193. New canonical hands freeze exact seat-row identity;
-- never infer it from timestamps or backfill ambiguous historical hands.
BEGIN;
SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='20s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR md5(replace(pg_get_functiondef('public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),''))<>'6b71e798f6239b7096342ef7e17e6784'
 OR md5(replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),''))<>'1672a3d20b25be4ca2283e6dc781e1be'
 OR to_regclass('floor_private.tracker_hand_seat_snapshots193') IS NOT NULL
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000193') THEN
  RAISE EXCEPTION 'tracker_seat193_baseline_drift_or_collision';END IF;
END $$;

CREATE TABLE floor_private.tracker_hand_seat_snapshots193 (
 hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
 player_id uuid NOT NULL,
 entry_number integer NOT NULL CHECK(entry_number>0),
 entry_id uuid NOT NULL REFERENCES public.tournament_entries(id),
 seat_id uuid NOT NULL REFERENCES public.tournament_seats(id),
 table_session_id uuid NOT NULL REFERENCES public.table_sessions(id),
 seat_number integer NOT NULL CHECK(seat_number BETWEEN 1 AND 9),
 PRIMARY KEY(hand_id,player_id,entry_number),UNIQUE(hand_id,seat_id)
);
ALTER TABLE floor_private.tracker_hand_seat_snapshots193 OWNER TO postgres;
ALTER TABLE floor_private.tracker_hand_seat_snapshots193 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_hand_seat_snapshots193 FROM PUBLIC,anon,authenticated,service_role;

DO $migration$
DECLARE definition text;marker text;replacement text;start_acl aclitem[];void_acl aclitem[];
BEGIN
 SELECT proacl INTO start_acl FROM pg_proc WHERE oid='public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure;
 SELECT proacl INTO void_acl FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure;
 SELECT replace(pg_get_functiondef('public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure),chr(13),'') INTO definition;
 marker:=$old$  RETURN pg_catalog.jsonb_build_object('status', 'success', 'hand_id', v_hand_id,$old$;
 replacement:=$new$  INSERT INTO floor_private.tracker_hand_seat_snapshots193(
    hand_id,player_id,entry_number,entry_id,seat_id,table_session_id,seat_number)
  SELECT v_hand_id,hp.player_id,hp.entry_number,e.id,s.id,v_session.id,hp.seat_number
  FROM public.hand_players hp
  JOIN public.tournament_seats s ON s.tournament_id=p_tournament_id
    AND s.tournament_table_id=v_table.id AND s.table_session_id=v_session.id
    AND s.player_id=hp.player_id AND s.entry_number=hp.entry_number
    AND s.seat_number=hp.seat_number AND s.is_active AND s.status='active'
  JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=p_tournament_id
    AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number AND e.status='seated'
  WHERE hp.hand_id=v_hand_id;
  IF (SELECT count(*) FROM floor_private.tracker_hand_seat_snapshots193 WHERE hand_id=v_hand_id)
    IS DISTINCT FROM (SELECT count(*) FROM public.hand_players WHERE hand_id=v_hand_id) THEN
    RAISE EXCEPTION 'tracker_start193_seat_snapshot_incomplete';
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'success', 'hand_id', v_hand_id,$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_seat193_start_marker_drift';END IF;
 EXECUTE replace(definition,marker,replacement);

 SELECT replace(pg_get_functiondef('public.void_last_hand(uuid)'::regprocedure),chr(13),'') INTO definition;
 marker:=$old$          AND ((e.status='seated' AND s.status='active' AND s.is_active)
            OR (e.status='busted' AND s.status='busted' AND NOT s.is_active)))<>1) THEN$old$;
 replacement:=$new$          AND ((e.status='seated' AND s.status='active' AND s.is_active)
            OR (e.status='busted' AND s.status='busted' AND NOT s.is_active))
          AND (NOT EXISTS(SELECT 1 FROM floor_private.tracker_hand_seat_snapshots193 any_snapshot WHERE any_snapshot.hand_id=p_hand_id)
            OR EXISTS(SELECT 1 FROM floor_private.tracker_hand_seat_snapshots193 snapshot
              WHERE snapshot.hand_id=p_hand_id AND snapshot.player_id=hp.player_id
                AND snapshot.entry_number=hp.entry_number AND snapshot.entry_id=e.id
                AND snapshot.table_session_id=v_hand_record.table_session_id
                AND snapshot.seat_number=hp.seat_number AND snapshot.seat_id=s.id)))<>1) THEN$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_seat193_guard_marker_drift';END IF;
 definition:=replace(definition,marker,replacement);
 marker:=$old$          AND ((e.status='seated' AND t.status='active' AND t.is_active)
            OR (e.status='busted' AND t.status='busted' AND NOT t.is_active)));$old$;
 replacement:=$new$          AND ((e.status='seated' AND t.status='active' AND t.is_active)
            OR (e.status='busted' AND t.status='busted' AND NOT t.is_active))
          AND (NOT EXISTS(SELECT 1 FROM floor_private.tracker_hand_seat_snapshots193 any_snapshot WHERE any_snapshot.hand_id=p_hand_id)
            OR EXISTS(SELECT 1 FROM floor_private.tracker_hand_seat_snapshots193 snapshot
              WHERE snapshot.hand_id=p_hand_id AND snapshot.player_id=v_player_record.player_id
                AND snapshot.entry_number=v_player_record.entry_number AND snapshot.entry_id=e.id
                AND snapshot.table_session_id=v_hand_record.table_session_id
                AND snapshot.seat_number=v_player_record.seat_number AND snapshot.seat_id=t.id)));$new$;
 IF array_length(string_to_array(definition,marker),1)<>2 THEN RAISE EXCEPTION 'tracker_seat193_writer_marker_drift';END IF;
 EXECUTE replace(definition,marker,replacement);
 IF (SELECT proacl FROM pg_proc WHERE oid='public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)'::regprocedure) IS DISTINCT FROM start_acl
 OR (SELECT proacl FROM pg_proc WHERE oid='public.void_last_hand(uuid)'::regprocedure) IS DISTINCT FROM void_acl THEN
  RAISE EXCEPTION 'tracker_seat193_acl_changed';END IF;
END $migration$;
COMMIT;
