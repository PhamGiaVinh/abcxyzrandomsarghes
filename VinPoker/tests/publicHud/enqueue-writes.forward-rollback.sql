-- Restore pre031 derived enqueue functions; source, counters, grants and leases retained.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN IF md5(replace(pg_get_functiondef('tracker_analytics_v1.enqueue(text,uuid,boolean)'::regprocedure),chr(13),''))<>'0650893a716858e40a966b9c9dd2a460' OR md5(replace(pg_get_functiondef('tracker_analytics_v1.outcome_changed()'::regprocedure),chr(13),''))<>'ee4e45ea372523c4aef8371aa16cf430' THEN RAISE EXCEPTION 'HUD enqueue write recovery differs';END IF;END $$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.enqueue(p_kind text,p_entity uuid,p_backfill boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_entity IS NULL THEN RETURN; END IF;
  IF p_kind='hand' AND NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=p_entity AND status='completed')
    AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=p_entity)
    AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions WHERE hand_id=p_entity) THEN RETURN; END IF;
  INSERT INTO tracker_analytics_v1.jobs(kind,entity_id,priority) VALUES(p_kind,p_entity,CASE WHEN p_backfill THEN 10 ELSE 0 END)
  ON CONFLICT(kind,entity_id) DO UPDATE SET generation=tracker_analytics_v1.jobs.generation+1,
    priority=least(tracker_analytics_v1.jobs.priority,excluded.priority),available_at=clock_timestamp(),
    lease_token=NULL,lease_until=NULL,attempts=0,error_code=NULL;
  IF p_kind='hand' THEN
    INSERT INTO tracker_analytics_v1.job_players(kind,entity_id,player_id,hard_block)
    SELECT p_kind,p_entity,affected.player_id,bool_or(affected.blocked) FROM (
      SELECT player_id,false AS blocked FROM public.hand_players WHERE hand_id=p_entity
      UNION ALL SELECT c.player_id,NOT EXISTS(
        SELECT 1 FROM public.tournament_hands h JOIN public.hand_players hp ON hp.hand_id=h.id
        WHERE h.id=p_entity AND h.tournament_id=c.tournament_id AND hp.tournament_id=c.tournament_id AND hp.player_id=c.player_id
          AND h.status='completed' AND NOT coalesce(h.is_voided,false))
      FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=p_entity
    ) affected GROUP BY affected.player_id
    ON CONFLICT(kind,entity_id,player_id) DO UPDATE SET hard_block=tracker_analytics_v1.job_players.hard_block OR excluded.hard_block;
  ELSIF p_kind='result' THEN
    INSERT INTO tracker_analytics_v1.job_players(kind,entity_id,player_id,hard_block)
    SELECT p_kind,p_entity,affected.player_id,bool_or(affected.blocked) FROM (
      SELECT c.player_id,NOT EXISTS(SELECT 1 FROM public.player_results r WHERE r.id=p_entity
        AND r.player_id=c.player_id AND r.verified_by_admin) AS blocked
      FROM tracker_analytics_v1.result_contributions c WHERE c.result_id=p_entity
      UNION ALL SELECT player_id,false FROM public.player_results WHERE id=p_entity
    ) affected GROUP BY affected.player_id
    ON CONFLICT(kind,entity_id,player_id) DO UPDATE SET hard_block=tracker_analytics_v1.job_players.hard_block OR excluded.hard_block;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.outcome_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM tracker_analytics_v1.enqueue('hand',OLD.hand_id); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM tracker_analytics_v1.enqueue('hand',NEW.hand_id); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
COMMIT;
