BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_public_player_hud_history_v1(uuid,uuid,timestamptz,uuid)'::regprocedure))<>'aacf00bc05c190a39e44c4078e2252dd' THEN
  RAISE EXCEPTION 'HUD history preimage differs';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_public_player_hud_history_v1(p_tournament_id uuid,p_player_id uuid,
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
    SELECT c.hand_id,c.hand_number,c.table_id,c.session_id,c.played_at,
      visible.current_source_revision,visible.tournament_status
    FROM tracker_analytics_v1.hand_contributions c
    CROSS JOIN LATERAL (
      -- Keep source gates correlated to each ordered contribution. OFFSET 0
      -- prevents a semi-join rewrite that scans/sorts the entire tour first.
      SELECT h.source_revision AS current_source_revision,t.status AS tournament_status
      FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
      WHERE h.id=c.hand_id AND h.tournament_id=c.tournament_id
        AND h.status='completed' AND NOT coalesce(h.is_voided,false) AND t.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM public.hand_players hp WHERE hp.hand_id=c.hand_id AND hp.player_id=p_player_id
          AND hp.tournament_id=p_tournament_id)
        AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.job_players j WHERE j.kind='hand' AND j.entity_id=c.hand_id
          AND j.player_id=p_player_id AND j.hard_block)
      LIMIT 1 OFFSET 0
    ) visible
    WHERE c.player_id=p_player_id AND c.tournament_id=p_tournament_id AND c.version=cfg.version
      AND (p_after_hand IS NULL OR
        (p_after_time IS NOT NULL AND (c.played_at<p_after_time OR c.played_at IS NULL OR (c.played_at=p_after_time AND c.hand_id<p_after_hand))) OR
        (p_after_time IS NULL AND c.played_at IS NULL AND c.hand_id<p_after_hand))
    ORDER BY c.played_at DESC NULLS LAST,c.hand_id DESC LIMIT 51
  ), checked AS MATERIALIZED (
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
COMMIT;
