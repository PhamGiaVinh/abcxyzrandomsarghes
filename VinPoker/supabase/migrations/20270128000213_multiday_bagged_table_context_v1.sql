-- Authorized read context for the real Floor UI. Never infer a session from a
-- reusable physical table. The write RPC still rechecks every integrity guard.
DO $$ BEGIN
 IF to_regprocedure('public.get_bagged_flight_tables_v1(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'bagged_context_catalog_collision';
 END IF;
 IF md5(replace(pg_get_functiondef('public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)'::regprocedure),chr(13),''))
  <> '2def3d435c90a7567a9bf3a9ba5660ca' THEN
  RAISE EXCEPTION 'bagged_context_release_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.get_bagged_flight_tables_v1(p_flight_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tour public.tournaments%ROWTYPE;
 v_end public.multi_day_flight_ends_v1%ROWTYPE; v_day public.day_close%ROWTYPE;
 v_tables jsonb; v_enabled boolean;
BEGIN
 IF v_actor IS NULL OR p_flight_tournament_id IS NULL THEN
  RAISE EXCEPTION 'bagged_context_actor_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_tour FROM public.tournaments WHERE id=p_flight_tournament_id;
 IF NOT FOUND OR v_tour.phase IS DISTINCT FROM 'flight'
  OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor,v_tour.club_id) THEN
  RAISE EXCEPTION 'bagged_context_scope_denied' USING ERRCODE='42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
  WHERE g.id AND g.enabled AND v_tour.club_id=ANY(g.allowed_club_ids)) INTO v_enabled;
 SELECT * INTO v_end FROM public.multi_day_flight_ends_v1 WHERE flight_tournament_id=v_tour.id;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('flightId',v_tour.id,'eventId',v_tour.event_id,
   'releaseEnabled',v_enabled,'state','playing','rosterHash',NULL,'dayVersion',NULL,'tables','[]'::jsonb);
 END IF;
 SELECT * INTO v_day FROM public.day_close WHERE tournament_id=v_tour.id AND day_number=v_end.day_number;
 IF v_end.status<>'locked' OR v_day.id IS NULL OR v_day.status<>'locked' THEN
  RETURN jsonb_build_object('flightId',v_tour.id,'eventId',v_tour.event_id,
   'releaseEnabled',v_enabled,'state','bagging','rosterHash',v_end.roster_hash,
   'dayVersion',v_day.version,'tables','[]'::jsonb);
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'tournamentTableId',r.tournament_table_id,'tableSessionId',r.table_session_id,
  'revision',s.revision,'name',gt.table_name,'playerCount',r.players,'baggedTotal',r.total,
  'state',CASE
   WHEN tt.id IS NULL OR s.id IS NULL OR gt.id IS NULL
    OR tt.tournament_id IS DISTINCT FROM v_tour.id OR tt.table_session_id IS DISTINCT FROM r.table_session_id
    OR s.tournament_id IS DISTINCT FROM v_tour.id OR s.club_id IS DISTINCT FROM v_tour.club_id
    OR s.game_table_id IS DISTINCT FROM tt.game_table_id OR gt.club_id IS DISTINCT FROM v_tour.club_id THEN 'blocked'
   WHEN s.closed_at IS NULL AND tt.status='active' THEN 'open'
   WHEN s.closed_at IS NOT NULL AND tt.status='closed' AND NOT EXISTS(
    SELECT 1 FROM public.multi_day_flight_roster_v1 frozen
    LEFT JOIN public.tournament_entries e ON e.id=frozen.entry_id
    LEFT JOIN public.tournament_seats seat ON seat.id=frozen.seat_id
    WHERE frozen.flight_tournament_id=v_tour.id AND frozen.tournament_table_id=r.tournament_table_id
     AND frozen.table_session_id=r.table_session_id
     AND (e.id IS NULL OR seat.id IS NULL OR e.status IS DISTINCT FROM 'bagged'
      OR seat.status IS DISTINCT FROM 'bagged' OR seat.is_active IS DISTINCT FROM false)
   ) THEN 'released' ELSE 'blocked' END
 ) ORDER BY r.tournament_table_id,r.table_session_id),'[]'::jsonb) INTO v_tables
 FROM (SELECT tournament_table_id,table_session_id,count(*) players,sum(tracked_stack) total
  FROM public.multi_day_flight_roster_v1 WHERE flight_tournament_id=v_tour.id
  GROUP BY tournament_table_id,table_session_id) r
 LEFT JOIN public.tournament_tables tt ON tt.id=r.tournament_table_id
 LEFT JOIN public.table_sessions s ON s.id=r.table_session_id
 LEFT JOIN public.game_tables gt ON gt.id=tt.game_table_id;
 RETURN jsonb_build_object('flightId',v_tour.id,'eventId',v_tour.event_id,
  'releaseEnabled',v_enabled,'state','locked','rosterHash',v_end.roster_hash,
  'dayVersion',v_day.version,'tables',v_tables);
END $$;
REVOKE ALL ON FUNCTION public.get_bagged_flight_tables_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_bagged_flight_tables_v1(uuid) TO authenticated;
