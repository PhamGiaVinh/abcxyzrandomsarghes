BEGIN;
-- CLI-created 20261024184940, reserved forward slot280 after local catalog collision check.
-- Read projection only. Never repair/backfill historical seat identity here.
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.fnb_list_link_targets(uuid)'::regprocedure))
    <> '638cb830a272e4cbcc897fdb6aa0bd65' THEN
  RAISE EXCEPTION 'FNB_LINK_TARGETS_PREDECESSOR_DRIFT';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fnb_list_link_targets(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE actor uuid := auth.uid(); result jsonb;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
 IF NOT (public.is_club_fnb(actor,p_club_id) OR public.is_club_owner(actor,p_club_id)) THEN
  RETURN jsonb_build_object('error','Forbidden');
 END IF;
 WITH open_sessions AS (
  SELECT s.*,count(*) OVER(PARTITION BY s.game_table_id) AS open_count
  FROM public.table_sessions s WHERE s.closed_at IS NULL
 ), valid_tables AS (
  SELECT g.id,g.table_name,g.status,s.id AS session_id
  FROM public.game_tables g JOIN open_sessions s ON s.game_table_id=g.id
  WHERE g.club_id=p_club_id AND g.status='active' AND s.club_id=g.club_id AND s.open_count=1
   AND (s.session_type IN('cash','vip') OR (s.session_type='tournament' AND 1=(
    SELECT count(*) FROM public.tournament_tables tt JOIN public.tournaments t ON t.id=tt.tournament_id
    WHERE tt.table_session_id=s.id AND tt.game_table_id=g.id AND tt.tournament_id=s.tournament_id
     AND (tt.table_id IS NULL OR tt.table_id=g.id) AND tt.status='active' AND t.club_id=g.club_id
     AND t.status IN('registering','drawing','active','live','break','final_table')
   )))
 ), candidates AS (
  SELECT ts.* FROM public.tournament_seats ts JOIN public.tournaments t ON t.id=ts.tournament_id
  WHERE t.club_id=p_club_id AND t.status IN('registering','drawing','active','live','break','final_table')
   AND ts.is_active
 ), verified_players AS (
  SELECT ts.id AS seat_id,ts.entry_id,ts.player_id,ts.tournament_id,ts.seat_number,
   tt.id AS tournament_table_id,v.id AS table_id,v.table_name,v.session_id AS table_session_id,
   coalesce(nullif(btrim(ts.player_name),''),pr.display_name,left(ts.player_id::text,6)) AS name
  FROM candidates ts
  JOIN public.tournament_tables tt ON tt.id=coalesce(ts.tournament_table_id,ts.table_id)
   AND tt.tournament_id=ts.tournament_id AND tt.status='active'
   AND (ts.table_id IS NULL OR ts.table_id=tt.id)
  JOIN valid_tables v ON v.id=tt.game_table_id AND v.session_id=tt.table_session_id
  JOIN public.table_sessions s ON s.id=v.session_id AND s.session_type='tournament'
   AND s.tournament_id=ts.tournament_id
  JOIN public.tournament_entries e ON e.id=ts.entry_id AND e.tournament_id=ts.tournament_id
   AND e.player_id=ts.player_id AND e.entry_no=ts.entry_number AND e.status='seated'
   AND e.table_id=v.id AND e.seat_id=ts.id AND e.seat_number=ts.seat_number
  LEFT JOIN public.profiles pr ON pr.user_id=ts.player_id
  WHERE ts.status='active' AND ts.table_session_id=v.session_id
   AND ts.seat_number BETWEEN 1 AND tt.max_seats
 )
 SELECT jsonb_build_object('status','ok',
  'tables',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'table_name',table_name,
   'status',status,'table_session_id',session_id) ORDER BY table_name,id) FROM valid_tables),'[]'::jsonb),
  'players',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY table_name,seat_number,seat_id)
   FROM verified_players p),'[]'::jsonb),
  'unavailable_player_count',(SELECT count(*) FROM candidates)-(SELECT count(*) FROM verified_players),
  'unavailable_table_count',(SELECT count(*) FROM public.game_tables WHERE club_id=p_club_id AND status='active')
    -(SELECT count(*) FROM valid_tables)) INTO result;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.fnb_list_link_targets(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fnb_list_link_targets(uuid) TO authenticated;
COMMIT;
