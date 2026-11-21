-- Pending HUD source patch. Reuse the existing bounded visibility job.
-- Rollback: restore the reviewed prior visibility_changed definition after
-- disabling dispatch and draining the queue. Preserve all contributions.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.visibility_changed()'::regprocedure),chr(13),''))
    IS DISTINCT FROM '1b3320cd0f08d14fde3f081c5b132246'
 THEN RAISE EXCEPTION 'HUD public status fingerprint dependency differs'; END IF;
END $$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.visibility_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO tracker_analytics_v1.visibility_barriers(tournament_id) VALUES(coalesce(NEW.id,OLD.id))
  ON CONFLICT(tournament_id) DO UPDATE SET changed_at=clock_timestamp();
  PERFORM tracker_analytics_v1.enqueue('visibility',coalesce(NEW.id,OLD.id));
  IF TG_OP='UPDATE' AND ((OLD.status IN ('live','final_table','completed','finished'))
    IS DISTINCT FROM (NEW.status IN ('live','final_table','completed','finished'))
    OR (OLD.status IS DISTINCT FROM NEW.status
      AND NEW.deleted_at IS NULL
      AND NEW.status IN ('live','final_table','completed','finished'))) THEN
    UPDATE tracker_analytics_v1.jobs SET refresh_hands=true,refresh_hidden_only=false,progress_cursor=NULL
      WHERE kind='visibility' AND entity_id=NEW.id;
  ELSIF TG_OP='UPDATE' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    -- Do not downgrade an already queued full eligibility refresh.
    UPDATE tracker_analytics_v1.jobs SET
      refresh_hidden_only=NOT (refresh_hands AND NOT refresh_hidden_only),
      refresh_hands=true,progress_cursor=NULL
      WHERE kind='visibility' AND entity_id=NEW.id;
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
COMMIT;
