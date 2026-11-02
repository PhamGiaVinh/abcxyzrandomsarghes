-- CLI-created20261015130352; forward90 after source/live collision check.
-- Read-only public projections only. No writers, backfill, raw identities,
-- table grants or replay of the historical live-center archive.
-- Rollback: reviewed forward revoke of these two new functions. Preserve data.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public.get_public_tournament_clock_summary(uuid)') IS NOT NULL
 OR to_regprocedure('public.get_public_tournament_results(uuid)') IS NOT NULL THEN
  RAISE EXCEPTION 'PUBLIC_CLOCK_RPC_ALREADY_EXISTS'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure)
 IS DISTINCT FROM 'b9624adaa8d7bb35713917486c40fe67'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)'::regprocedure)
 IS DISTINCT FROM '52b7d31925be84bcfb08df7ba913ab69' THEN
  RAISE EXCEPTION 'PUBLIC_CLOCK_DEPENDENCY_DRIFT'; END IF;
END $$;

CREATE FUNCTION public.get_public_tournament_clock_summary(p_tournament_id uuid)
RETURNS TABLE(tournament_id uuid,name text,status text,starts_at timestamptz,
 guarantee numeric,buy_in numeric,players_remaining bigint,current_level integer,
 small_blind numeric,big_blind numeric,big_blind_ante numeric,level_ends_at timestamptz,
 next_small_blind numeric,next_big_blind numeric,next_big_blind_ante numeric,
 entries bigint,average_stack numeric,remaining_seconds integer,is_running boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
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
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_clock_summary(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_clock_summary(uuid) TO anon,authenticated;

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
COMMIT;
