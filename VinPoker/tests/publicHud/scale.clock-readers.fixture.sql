-- Canonical read-only function definitions captured from production catalog on 2026-11-04.
-- Synthetic fixture only. No production data or credentials. Exact hashes are checked by the seed.
-- floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer): b7f94cbd3c2df431d317d6ba8180edbf
CREATE OR REPLACE FUNCTION floor_private.tournament_entry_display_v1(p_entry_id uuid, p_player_id uuid, p_tournament_id uuid, p_entry_no integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT pg_catalog.jsonb_build_object(
  'player_name',(SELECT NULLIF(pg_catalog.btrim(q.player_name),'')
   FROM public.tournament_seats q
   WHERE q.entry_id=e.id AND q.player_id=e.player_id
    AND q.tournament_id=e.tournament_id AND q.entry_number=e.entry_no
    AND NULLIF(pg_catalog.btrim(q.player_name),'') IS NOT NULL
   ORDER BY q.is_active DESC,q.created_at DESC,q.id DESC LIMIT 1)
 ) FROM public.tournament_entries e
 WHERE e.id=p_entry_id AND e.player_id=p_player_id
  AND e.tournament_id=p_tournament_id AND e.entry_no=p_entry_no;
$function$
;

-- floor_private.tournament_participation_v1(uuid): 56ba24560015d089565378b96e403925
CREATE OR REPLACE FUNCTION floor_private.tournament_participation_v1(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 WITH entries AS (
  SELECT e.*,count(*) OVER (PARTITION BY e.player_id,e.entry_no) generation_count
  FROM public.tournament_entries e WHERE e.tournament_id=p_tournament_id
 ), seats AS (
  SELECT q.*,t.table_name,e.current_stack entry_stack,cc.chip_count projected_stack,
   count(*) OVER (PARTITION BY q.entry_id) entry_seat_count,
   count(*) OVER (PARTITION BY q.table_session_id,q.seat_number) position_count,
   CASE
    WHEN e.id IS NULL THEN 'missing_entry'
    WHEN e.tournament_id IS DISTINCT FROM q.tournament_id OR e.player_id IS DISTINCT FROM q.player_id
      OR e.entry_no IS DISTINCT FROM q.entry_number THEN 'entry_identity_mismatch'
    WHEN e.status NOT IN ('registered','seated') THEN 'entry_not_live'
    WHEN t.id IS NULL OR s.id IS NULL THEN 'missing_table_session'
    WHEN s.closed_at IS NOT NULL THEN 'closed_session'
    WHEN t.status IS DISTINCT FROM 'active' THEN 'inactive_table'
    WHEN t.tournament_id IS DISTINCT FROM q.tournament_id OR t.table_session_id IS DISTINCT FROM s.id
      OR s.tournament_id IS DISTINCT FROM q.tournament_id OR s.club_id IS DISTINCT FROM c.club_id
      OR s.game_table_id IS DISTINCT FROM t.game_table_id OR g.club_id IS DISTINCT FROM c.club_id
      OR q.table_id IS DISTINCT FROM t.id THEN 'table_session_mismatch'
    WHEN q.seat_number NOT BETWEEN 1 AND t.max_seats THEN 'seat_out_of_range'
    WHEN e.current_stack IS DISTINCT FROM q.chip_count
      OR cc.chip_count IS DISTINCT FROM q.chip_count THEN 'stack_projection_mismatch'
    ELSE NULL
   END lineage_error
  FROM public.tournament_seats q
  JOIN public.tournaments c ON c.id=q.tournament_id
  LEFT JOIN public.tournament_entries e ON e.id=q.entry_id
  LEFT JOIN public.tournament_tables t ON t.id=q.tournament_table_id
  LEFT JOIN public.table_sessions s ON s.id=q.table_session_id
  LEFT JOIN public.game_tables g ON g.id=t.game_table_id
  LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id=q.tournament_id
    AND cc.player_id=q.player_id AND cc.entry_number=q.entry_number
  WHERE q.tournament_id=p_tournament_id AND q.is_active
 ), classified_seats AS (
  SELECT s.*,COALESCE(lineage_error,
    CASE WHEN entry_seat_count<>1 THEN 'duplicate_entry_seat'
         WHEN position_count<>1 THEN 'duplicate_seat_position'
         WHEN e.generation_count<>1 THEN 'duplicate_entry_generation' END) anomaly_reason
  FROM seats s LEFT JOIN entries e ON e.id=s.entry_id
 ), classified_entries AS (
  SELECT e.*,
   CASE WHEN e.generation_count<>1 THEN 'anomaly'
    WHEN EXISTS(SELECT 1 FROM classified_seats s WHERE s.entry_id=e.id AND s.anomaly_reason IS NOT NULL) THEN 'anomaly'
    WHEN e.status='bagged' THEN 'bagged'
    WHEN e.status='busted' THEN 'busted'
    WHEN e.status='finished' THEN 'finished'
    WHEN e.status='cancelled' THEN 'cancelled'
    WHEN EXISTS(SELECT 1 FROM classified_seats s WHERE s.entry_id=e.id AND s.anomaly_reason IS NULL) THEN 'seated'
    WHEN e.status='seated' THEN 'anomaly'
    ELSE 'waiting' END participation_status,
   CASE WHEN e.generation_count<>1 THEN 'duplicate_entry_generation'
    WHEN e.status='seated' AND NOT EXISTS(SELECT 1 FROM classified_seats s WHERE s.entry_id=e.id)
    THEN 'missing_active_seat' END entry_anomaly_reason,
   COALESCE((floor_private.tournament_entry_display_v1(e.id,e.player_id,e.tournament_id,e.entry_no)->>'player_name'),'') player_name
  FROM entries e
 )
 SELECT jsonb_build_object('tournament_id',p_tournament_id,
  'seats',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'seat_id',s.id,'entry_id',s.entry_id,'player_id',s.player_id,'player_name',COALESCE(NULLIF(pg_catalog.btrim(s.player_name),''),floor_private.tournament_entry_display_v1(s.entry_id,s.player_id,s.tournament_id,s.entry_number)->>'player_name',s.player_name),'avatar_url',s.avatar_url,
   'entry_number',s.entry_number,'table_id',s.table_id,'tournament_table_id',s.tournament_table_id,
   'table_session_id',s.table_session_id,'table_name',s.table_name,'seat_number',s.seat_number,
   'chip_count',s.chip_count,'entry_stack',s.entry_stack,'projected_stack',s.projected_stack,
   'is_active',true,'participation_status',
    CASE WHEN s.anomaly_reason IS NULL THEN 'seated' ELSE 'anomaly' END,
   'anomaly_reason',s.anomaly_reason) ORDER BY s.table_id,s.seat_number,s.id)
   FROM classified_seats s),'[]'::jsonb),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id,'player_id',e.player_id,'player_name',e.player_name,'entry_no',e.entry_no,
   'status',e.status,'current_stack',e.current_stack,'seat_number',e.seat_number,
   'finished_place',e.finished_place,'participation_status',e.participation_status,
   'anomaly_reason',COALESCE(e.entry_anomaly_reason,
     (SELECT s.anomaly_reason FROM classified_seats s WHERE s.entry_id=e.id AND s.anomaly_reason IS NOT NULL ORDER BY s.id LIMIT 1)))
   ORDER BY e.player_id,e.entry_no,e.id) FROM classified_entries e),'[]'::jsonb),
  'counts',(SELECT jsonb_build_object(
   'total_entries',count(DISTINCT (player_id,entry_no)) FILTER(WHERE status<>'cancelled'),
   're_entries',count(DISTINCT (player_id,entry_no)) FILTER(WHERE status<>'cancelled' AND entry_no>1),
   'remaining',count(DISTINCT (player_id,entry_no)) FILTER(WHERE status IN ('registered','seated')),
   'seated',count(*) FILTER(WHERE participation_status='seated'),
   'waiting',count(*) FILTER(WHERE participation_status='waiting'),
   'busted',count(*) FILTER(WHERE participation_status='busted'),
   'anomaly_entries',count(*) FILTER(WHERE participation_status='anomaly'),
   'anomaly_seats',(SELECT count(*) FROM classified_seats WHERE anomaly_reason IS NOT NULL),
   'live_entry_stack',COALESCE(sum(current_stack) FILTER(WHERE status IN ('registered','seated')),0),
   'seated_stack',(SELECT COALESCE(sum(chip_count),0) FROM classified_seats WHERE anomaly_reason IS NULL),
   'waiting_stack',COALESCE(sum(current_stack) FILTER(WHERE participation_status='waiting'),0)
  ) FROM classified_entries));
$function$
;

-- get_tournament_clock(uuid): ce2dec34ad1a422ba7f734717c3fd967
CREATE OR REPLACE FUNCTION public.get_tournament_clock(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tournament RECORD;
  v_elapsed INTEGER;
  v_remaining INTEGER;
  v_current_level RECORD;
  v_is_running BOOLEAN;
  v_is_break BOOLEAN;
  v_control_revision TEXT;
BEGIN
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Tournament not found');
  END IF;

  v_control_revision := md5(jsonb_build_array(
    v_tournament.current_level,
    EXTRACT(EPOCH FROM v_tournament.clock_started_at),
    EXTRACT(EPOCH FROM v_tournament.clock_paused_at),
    COALESCE(v_tournament.pause_accumulated, 0)
  )::TEXT);

  IF v_tournament.clock_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'tournament_id', p_tournament_id,
      'status', v_tournament.status,
      'is_running', false,
      'elapsed_seconds', 0,
      'remaining_seconds', 0,
      'clock_paused_at', NULL,
      'current_level', NULL,
      'is_break', false,
      'message', 'Clock not started',
      'control_revision', v_control_revision
    );
  END IF;

  v_elapsed := EXTRACT(EPOCH FROM (
    COALESCE(v_tournament.clock_paused_at, now())
      - v_tournament.clock_started_at
  ))::INTEGER - COALESCE(v_tournament.pause_accumulated, 0);

  SELECT * INTO v_current_level
  FROM public.tournament_levels
  WHERE tournament_id = p_tournament_id
    AND level_number = v_tournament.current_level;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tournament_id', p_tournament_id,
      'status', v_tournament.status,
      'is_running', false,
      'elapsed_seconds', v_elapsed,
      'remaining_seconds', 0,
      'clock_paused_at', v_tournament.clock_paused_at,
      'current_level', NULL,
      'is_break', false,
      'message', 'Current level not found',
      'control_revision', v_control_revision
    );
  END IF;

  v_remaining := (v_current_level.duration_minutes * 60) - v_elapsed;
  v_is_break := v_current_level.is_break;
  v_is_running := v_tournament.status::TEXT IN ('live', 'final_table')
    AND v_tournament.clock_paused_at IS NULL;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'status', v_tournament.status,
    'is_running', v_is_running,
    'elapsed_seconds', v_elapsed,
    'remaining_seconds', GREATEST(v_remaining, 0),
    'clock_paused_at', v_tournament.clock_paused_at,
    'current_level', jsonb_build_object(
      'id', v_current_level.id,
      'level_number', v_current_level.level_number,
      'small_blind', v_current_level.small_blind,
      'big_blind', v_current_level.big_blind,
      'ante', v_current_level.ante,
      'duration_minutes', v_current_level.duration_minutes,
      'is_break', v_current_level.is_break
    ),
    'is_break', v_is_break,
    'next_level', (
      SELECT jsonb_build_object(
        'id', id,
        'level_number', level_number,
        'small_blind', small_blind,
        'big_blind', big_blind,
        'ante', ante,
        'duration_minutes', duration_minutes,
        'is_break', is_break
      )
      FROM public.tournament_levels
      WHERE tournament_id = p_tournament_id
        AND level_number = v_tournament.current_level + 1
    ),
    'control_revision', v_control_revision
  );
END;
$function$
;

-- get_public_tournament_clock_summary(uuid): bf84cbeb48770e13805718e0d8a0def9
CREATE OR REPLACE FUNCTION public.get_public_tournament_clock_summary(p_tournament_id uuid)
 RETURNS TABLE(tournament_id uuid, name text, status text, starts_at timestamp with time zone, guarantee numeric, buy_in numeric, players_remaining bigint, current_level integer, small_blind numeric, big_blind numeric, big_blind_ante numeric, level_ends_at timestamp with time zone, next_small_blind numeric, next_big_blind numeric, next_big_blind_ante numeric, entries bigint, average_stack numeric, remaining_seconds integer, is_running boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 WITH target AS (
  SELECT t.* FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL
 ), summary AS (
  SELECT t.*,floor_private.tournament_participation_v1(t.id)->'counts' counts FROM target t
 ), clock AS (
  SELECT t.*,l.small_blind,l.big_blind,l.ante,l.duration_minutes,
   (l.id IS NOT NULL AND t.clock_started_at IS NOT NULL AND t.clock_paused_at IS NULL
     AND lower(t.status::text) IN ('live','running','in_progress','active','final_table','break')) advancing,
   CASE WHEN t.clock_started_at IS NULL OR l.id IS NULL THEN NULL ELSE
    greatest(l.duration_minutes*60 - greatest(extract(epoch FROM
     (coalesce(t.clock_paused_at,statement_timestamp())-t.clock_started_at))::integer
      -coalesce(t.pause_accumulated,0),0),0) END remaining
  FROM summary t LEFT JOIN public.tournament_levels l ON l.tournament_id=t.id AND l.level_number=t.current_level
 )
 SELECT t.id,t.name,t.status::text,t.start_time,t.guarantee_amount,t.buy_in,
  (t.counts->>'remaining')::bigint,t.current_level,t.small_blind::numeric,t.big_blind::numeric,t.ante::numeric,
  CASE WHEN t.advancing AND t.remaining IS NOT NULL THEN statement_timestamp()+make_interval(secs=>t.remaining) END,
  n.small_blind::numeric,n.big_blind::numeric,n.ante::numeric,(t.counts->>'total_entries')::bigint,
  CASE WHEN (t.counts->>'remaining')::bigint=0 THEN 0
    ELSE round((t.counts->>'live_entry_stack')::numeric/(t.counts->>'remaining')::numeric) END,
  t.remaining,t.advancing
 FROM clock t LEFT JOIN LATERAL (
  SELECT l.small_blind,l.big_blind,l.ante FROM public.tournament_levels l
  WHERE l.tournament_id=t.id AND l.level_number>coalesce(t.current_level,0) AND NOT l.is_break
  ORDER BY l.level_number LIMIT 1
 ) n ON true;
$function$
;

REVOKE ALL ON FUNCTION floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer),floor_private.tournament_participation_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_tournament_clock(uuid),public.get_public_tournament_clock_summary(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_clock(uuid) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_clock_summary(uuid) TO anon,authenticated;
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)'::regprocedure),chr(13),''))<>'b7f94cbd3c2df431d317d6ba8180edbf' THEN RAISE EXCEPTION 'canonical_clock_fixture_drift';END IF;
 IF md5(replace(pg_get_functiondef('floor_private.tournament_participation_v1(uuid)'::regprocedure),chr(13),''))<>'56ba24560015d089565378b96e403925' THEN RAISE EXCEPTION 'canonical_clock_fixture_drift';END IF;
 IF md5(replace(pg_get_functiondef('public.get_tournament_clock(uuid)'::regprocedure),chr(13),''))<>'ce2dec34ad1a422ba7f734717c3fd967' THEN RAISE EXCEPTION 'canonical_clock_fixture_drift';END IF;
 IF md5(replace(pg_get_functiondef('public.get_public_tournament_clock_summary(uuid)'::regprocedure),chr(13),''))<>'bf84cbeb48770e13805718e0d8a0def9' THEN RAISE EXCEPTION 'canonical_clock_fixture_drift';END IF;
END $$;


-- Exact public payout adapter from forward90; no business writer or table grants.
CREATE FUNCTION public.get_public_tournament_results(p_tournament_id uuid)
RETURNS TABLE(place integer,prize numeric,player_name text,avatar_url text,result_status text,awarded_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; payout jsonb;
BEGIN
 snapshot:=public.get_public_tournament_viewer_snapshot_v2(p_tournament_id,ARRAY[]::uuid[],ARRAY['payout']::text[],'{}'::jsonb);
 IF snapshot->>'access'='revoked' THEN RETURN; END IF;
 payout:=snapshot->'sections'->'payout';
 IF (snapshot->>'ok')::boolean IS NOT TRUE OR payout->>'revision' IS NULL OR payout->>'revision'='0'
  OR payout->'freshness'->>'state' IS DISTINCT FROM 'current'
  OR jsonb_typeof(payout->'items') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'public_payout_pending'; END IF;
 RETURN QUERY SELECT g.position,(i->>'amountPerPlayer')::numeric,
  CASE WHEN i->>'resultStatus'='official' THEN i->>'playerName' END,
  CASE WHEN i->>'resultStatus'='official' THEN i->>'avatarUrl' END,
  CASE WHEN i->>'resultStatus'='official' THEN 'official' ELSE 'open' END,NULL::timestamptz
 FROM jsonb_array_elements(payout->'items') i
 CROSS JOIN LATERAL generate_series((i->>'fromPlace')::integer,(i->>'toPlace')::integer) g(position)
 ORDER BY g.position;
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_results(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_results(uuid) TO anon,authenticated;
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_public_tournament_results(uuid)'::regprocedure)<>'a636e567407c6f615526afbdf2ffaeb6' THEN RAISE EXCEPTION 'canonical_payout_fixture_drift';END IF;
END $$;
