-- Reduce redundant derived writes, preserving sticky withdrawal and job fencing.
-- Recovery: tests/publicHud/enqueue-writes.forward-rollback.sql, before030.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.enqueue(text,uuid,boolean)'::regprocedure),chr(13),''))<>'254e7c518947be9f67a816c9b60850ee'
 OR md5(replace(pg_get_functiondef('tracker_analytics_v1.outcome_changed()'::regprocedure),chr(13),''))<>'fbb5f17d0ee565045237227e59d4bd94' THEN
 RAISE EXCEPTION 'HUD enqueue write preimage differs';END IF;
END $guard$;
DO $rewrite$ DECLARE body text; target text; replacement text; BEGIN
 body:=replace(pg_get_functiondef('tracker_analytics_v1.enqueue(text,uuid,boolean)'::regprocedure),chr(13),'');
 target:='ON CONFLICT(kind,entity_id,player_id) DO UPDATE SET hard_block=tracker_analytics_v1.job_players.hard_block OR excluded.hard_block;';
 replacement:='ON CONFLICT(kind,entity_id,player_id) DO UPDATE SET hard_block=tracker_analytics_v1.job_players.hard_block OR excluded.hard_block
    WHERE tracker_analytics_v1.job_players.hard_block IS DISTINCT FROM (tracker_analytics_v1.job_players.hard_block OR excluded.hard_block);';
 IF (length(body)-length(replace(body,target,'')))/length(target)<>2 THEN RAISE EXCEPTION 'HUD enqueue write rewrite differs';END IF;
 -- Job generation, priority, attempts and lease invalidation remain unchanged.
 -- New players and false-to-true blocks still write and run withdrawal triggers.
 EXECUTE replace(body,target,replacement);
END $rewrite$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.outcome_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM tracker_analytics_v1.enqueue('hand',OLD.hand_id); END IF;
  IF TG_OP='INSERT' THEN
    PERFORM tracker_analytics_v1.enqueue('hand',NEW.hand_id);
  ELSIF TG_OP='UPDATE' AND NEW.hand_id IS DISTINCT FROM OLD.hand_id THEN
    PERFORM tracker_analytics_v1.enqueue('hand',NEW.hand_id);
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
COMMIT;
