BEGIN;
CREATE INDEX idx_hud_player_tournament_hand ON public.hand_players(player_id,tournament_id,hand_id);
CREATE INDEX idx_hud_verified_result_page ON public.player_results(player_id,event_date DESC,id) WHERE verified_by_admin;

CREATE FUNCTION tracker_analytics_v1.public_context(p_tournament uuid,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE ranking jsonb; identity jsonb;
BEGIN
  -- Same public tournament gate as the existing viewer snapshot. An operator
  -- bearer never widens this projection's anonymous/public scope.
  IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament AND deleted_at IS NULL) THEN RETURN NULL; END IF;
  SELECT p.payload INTO ranking FROM spectator_projection_v2.publications p
    WHERE p.tournament_id=p_tournament AND p.component='ranking';
  SELECT r INTO identity FROM jsonb_array_elements(coalesce(ranking->'items','[]'::jsonb)) r WHERE r->>'playerId'=p_player::text LIMIT 1;
  IF identity IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id AND h.tournament_id=hp.tournament_id
      WHERE hp.player_id=p_player AND hp.tournament_id=p_tournament) THEN RETURN NULL; END IF;
    SELECT jsonb_build_object('name',hp.player_name,'avatarUrl',hp.avatar_url) INTO identity
      FROM tracker_analytics_v1.hand_contributions c JOIN public.hand_players hp ON hp.hand_id=c.hand_id AND hp.player_id=c.player_id
      WHERE c.player_id=p_player AND c.tournament_id=p_tournament
      ORDER BY c.played_at DESC NULLS LAST,c.hand_id DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('name',coalesce(identity->>'name','Người chơi'),'avatarUrl',identity->'avatarUrl');
END $$;

CREATE FUNCTION public.get_public_player_hud_summary_v1(p_tournament_id uuid,p_player_id uuid,p_access_snapshot text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; cfg tracker_analytics_v1.config; total tracker_analytics_v1.player_totals; pending boolean;
BEGIN
  IF p_tournament_id IS NULL OR p_player_id IS NULL THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  IF p_access_snapshot IS NOT NULL AND length(p_access_snapshot)>8192 THEN RAISE EXCEPTION 'invalid_access_snapshot'; END IF;
  context:=tracker_analytics_v1.public_context(p_tournament_id,p_player_id);
  IF context IS NULL THEN RETURN jsonb_build_object('access','revoked'); END IF;
  SELECT * INTO cfg FROM tracker_analytics_v1.config WHERE singleton;
  IF NOT cfg.enabled OR NOT cfg.backfill_complete THEN RETURN jsonb_build_object('access','public','state','warming'); END IF;
  IF EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players WHERE player_id=p_player_id AND hard_block)
    OR EXISTS(SELECT 1 FROM tracker_analytics_v1.visibility_barriers v
      JOIN tracker_analytics_v1.tournament_totals t ON t.tournament_id=v.tournament_id
      WHERE t.player_id=p_player_id AND t.version=cfg.version) THEN
    RETURN jsonb_build_object('access','public','state','unavailable');
  END IF;
  SELECT * INTO total FROM tracker_analytics_v1.player_totals WHERE player_id=p_player_id AND version=cfg.version;
  pending:=EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players WHERE player_id=p_player_id);
  -- Coverage is certified by backfill, not inferred from a missing query result.
  -- A new player with pending work is warming; a certified zero stays unknown
  -- per metric (zero opportunities), never a manufactured 0%.
  IF total.player_id IS NULL AND pending THEN RETURN jsonb_build_object('access','public','state','warming'); END IF;
  RETURN context||jsonb_build_object('access','public','scope','all-public-tournaments',
    'tournamentId',p_tournament_id,'playerId',p_player_id,'version',cfg.version,
    'revision',coalesce(total.revision,0)::text,'computedAt',coalesce(total.computed_at,cfg.backfill_started_at),
    'accessSnapshot',pg_current_snapshot()::text,
    'accessChanged',CASE WHEN p_access_snapshot IS NULL THEN false ELSE EXISTS(
      SELECT 1 FROM tracker_analytics_v1.access_revocations
      WHERE source_txid>=pg_snapshot_xmin(p_access_snapshot::pg_snapshot)
       AND NOT pg_visible_in_snapshot(source_txid,p_access_snapshot::pg_snapshot)) END,
    'state',CASE WHEN pending THEN 'updating' ELSE 'current' END,
    'coverageComplete',true,'counters',jsonb_build_object(
      'numerators',coalesce(total.numerators,tracker_analytics_v1.zeros()),
      'denominators',coalesce(total.denominators,tracker_analytics_v1.zeros()),
      'missingProof',coalesce(total.missing_proof,tracker_analytics_v1.zeros()),
      'handsObserved',coalesce(total.observed_hands,0),'publicHands',coalesce(total.public_hands,0),'omittedHands',coalesce(total.omitted_hands,0)),
    'totalWinnings',CASE WHEN total.result_count>0 AND total.winnings<=9007199254740991 THEN total.winnings ELSE NULL END,
    'recentResults',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (
      SELECT tournament_name,event_date,position,total_entries,prize FROM tracker_analytics_v1.result_contributions
      WHERE player_id=p_player_id AND version=cfg.version ORDER BY event_date DESC,result_id LIMIT 5) r));
END $$;

CREATE FUNCTION tracker_analytics_v1.safe_integer(value jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n numeric;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  n:=value::numeric;
  IF n<>trunc(n) OR abs(n)>9007199254740991 THEN RETURN NULL; END IF;
  RETURN n;
END $$;

CREATE FUNCTION public.get_public_player_hud_history_v1(p_tournament_id uuid,p_player_id uuid,
  p_after_time timestamptz DEFAULT NULL,p_after_hand uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; cfg tracker_analytics_v1.config; rows jsonb; has_more boolean; last_row jsonb;
BEGIN
  IF p_tournament_id IS NULL OR p_player_id IS NULL THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  context:=tracker_analytics_v1.public_context(p_tournament_id,p_player_id);
  IF context IS NULL THEN RETURN jsonb_build_object('access','revoked'); END IF;
  SELECT * INTO cfg FROM tracker_analytics_v1.config WHERE singleton;
  IF NOT cfg.enabled OR NOT cfg.backfill_complete THEN RETURN jsonb_build_object('access','public','state','warming'); END IF;
  WITH page AS MATERIALIZED (
    SELECT c.*,h.source_revision AS current_source_revision,t.status AS tournament_status
    FROM tracker_analytics_v1.hand_contributions c
    JOIN public.tournament_hands h ON h.id=c.hand_id AND h.tournament_id=c.tournament_id
    JOIN public.tournaments t ON t.id=h.tournament_id
    WHERE c.player_id=p_player_id AND c.tournament_id=p_tournament_id AND c.version=cfg.version
      AND h.status='completed' AND NOT coalesce(h.is_voided,false) AND t.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=c.hand_id AND hp.player_id=p_player_id
        AND hp.tournament_id=p_tournament_id)
      AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players j WHERE j.kind='hand' AND j.entity_id=c.hand_id
        AND j.player_id=p_player_id AND j.hard_block)
      AND (p_after_hand IS NULL OR
        (p_after_time IS NOT NULL AND (c.played_at<p_after_time OR c.played_at IS NULL OR (c.played_at=p_after_time AND c.hand_id<p_after_hand))) OR
        (p_after_time IS NULL AND c.played_at IS NULL AND c.hand_id<p_after_hand))
    ORDER BY c.played_at DESC NULLS LAST,c.hand_id DESC LIMIT 51
  ), checked AS (
    SELECT p.*,proof.public_outcome->'players' AS outcome_players,
      (SELECT CASE WHEN count(*)=1 THEN min(hp.starting_stack) END FROM public.hand_players hp WHERE hp.hand_id=p.hand_id AND hp.player_id=p_player_id) AS seed
    FROM page p LEFT JOIN LATERAL (
      SELECT o.public_outcome FROM public.tournament_settlement_outcomes o WHERE o.hand_id=p.hand_id
        AND o.status='verified' AND o.source_revision=p.current_source_revision
        AND p.tournament_status IN ('live','final_table','completed','finished')
        AND o.public_outcome->>'schemaVersion'='settlement-outcome-v1' AND o.public_outcome->>'status'='verified'
        AND jsonb_typeof(o.public_outcome->'pots')='array' AND jsonb_typeof(o.public_outcome->'handRanks')='array'
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.public_outcome->'pots')='array' THEN o.public_outcome->'pots' ELSE '[]'::jsonb END) pot WHERE jsonb_typeof(pot->'winnerIds') IS DISTINCT FROM 'array')
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.public_outcome->'handRanks')='array' THEN o.public_outcome->'handRanks' ELSE '[]'::jsonb END) rank WHERE jsonb_typeof(rank->'playerId') IS DISTINCT FROM 'string')
      ORDER BY o.settlement_revision DESC LIMIT 1
    ) proof ON true
  ), amounts AS (
    SELECT c.*,tracker_analytics_v1.safe_integer(outcome->'startingStack') AS start,
      tracker_analytics_v1.safe_integer(outcome->'endingStack') AS ending,
      tracker_analytics_v1.safe_integer(outcome->'netDelta') AS delta,
      tracker_analytics_v1.safe_integer(outcome->'externalDelta') AS external
    FROM checked c LEFT JOIN LATERAL (
      SELECT x AS outcome FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.outcome_players)='array' THEN c.outcome_players ELSE '[]'::jsonb END) x
      WHERE x->>'playerId'=p_player_id::text LIMIT 1
    ) target ON true
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('handId',hand_id,'handNumber',hand_number,
    'tableId',table_id,'tableSessionId',session_id,'playedAt',played_at,
    'endingStack',CASE WHEN seed=start AND seed>=0 AND ending>=0 AND start+delta+external=ending THEN ending ELSE NULL END,
    'netDelta',CASE WHEN seed=start AND seed>=0 AND ending>=0 AND start+delta+external=ending THEN delta ELSE NULL END)
    ORDER BY played_at DESC NULLS LAST,hand_id DESC),'[]'::jsonb) INTO rows FROM amounts;
  has_more:=jsonb_array_length(rows)>50;
  IF has_more THEN rows:=rows-50; END IF;
  last_row:=rows->(jsonb_array_length(rows)-1);
  RETURN context||jsonb_build_object('access','public','state','current','tournamentId',p_tournament_id,'playerId',p_player_id,
    'handHistory',rows,'nextCursor',CASE WHEN has_more THEN jsonb_build_object('playedAt',last_row->'playedAt','handId',last_row->>'handId') ELSE NULL END);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tracker_analytics_v1 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_public_player_hud_summary_v1(uuid,uuid,text),
  public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_player_hud_summary_v1(uuid,uuid,text),
  public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid) TO anon,authenticated,service_role;
COMMIT;
