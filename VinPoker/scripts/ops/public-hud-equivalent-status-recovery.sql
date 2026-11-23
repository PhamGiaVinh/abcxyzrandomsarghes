-- Function recovery only. Keep HUD disabled until source and derived rows
-- are reconciled against the restored fingerprint contract, including deletions.
-- No contribution, source, or migration-history rows are removed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.visibility_barriers)
 THEN RAISE EXCEPTION 'HUD function recovery requires disabled reads and drained jobs'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
      WHERE oid='tracker_analytics_v1.hand_fingerprint(uuid)'::regprocedure)
        IS DISTINCT FROM '30c14514ffa4d20111fcbd028d96c921'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc
      WHERE oid='tracker_analytics_v1.visibility_changed()'::regprocedure)
        IS DISTINCT FROM 'ae3bba424a7cc0c9d9b8579c068a09fd'
 THEN RAISE EXCEPTION 'HUD function recovery postimage differs'; END IF;
END $$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.hand_fingerprint(p_hand uuid) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT md5(jsonb_build_object(
    'hand',(SELECT jsonb_build_array(h.id,h.tournament_id,h.source_revision,h.status,h.is_voided,h.hand_time,h.hand_number)
      FROM public.tournament_hands h WHERE h.id=p_hand),
    'policy',(SELECT jsonb_build_array(t.deleted_at,t.status) FROM public.tournaments t
      JOIN public.tournament_hands h ON h.tournament_id=t.id WHERE h.id=p_hand),
    'proof',(SELECT jsonb_agg(jsonb_build_array(o.id,o.source_revision,o.settlement_revision,o.status,o.public_outcome)
      ORDER BY o.settlement_revision,o.id) FROM public.tournament_settlement_outcomes o WHERE o.hand_id=p_hand)
  )::text)
$$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.visibility_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO tracker_analytics_v1.visibility_barriers(tournament_id) VALUES(coalesce(NEW.id,OLD.id))
  ON CONFLICT(tournament_id) DO UPDATE SET changed_at=clock_timestamp();
  PERFORM tracker_analytics_v1.enqueue('visibility',coalesce(NEW.id,OLD.id));
  IF TG_OP='UPDATE' AND ((OLD.status IN ('live','final_table','completed','finished'))
    IS DISTINCT FROM (NEW.status IN ('live','final_table','completed','finished'))) THEN
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
