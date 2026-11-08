-- A public profile result is not a tournament ranking/payout/clock source.
-- Keep global HUD withdrawal and transactional barriers; hand/tour invalidation
-- remains unchanged, including immediate removal of displayed live/replay data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.broadcast_withdrawal_v1()'::regprocedure),chr(13),''))<>'d21e991e6f1709070c370e43488d6eb2' THEN
  RAISE EXCEPTION 'HUD result withdrawal preimage differs';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.broadcast_withdrawal_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row record;
BEGIN
 IF NOT NEW.hard_block THEN RETURN NEW; END IF;
 PERFORM tracker_analytics_v1.queue_revocation_v1();
 IF NEW.kind='hand' THEN
  FOR row IN SELECT DISTINCT tournament_id FROM tracker_analytics_v1.hand_contributions WHERE hand_id=NEW.entity_id LOOP
   PERFORM spectator_projection_v2.queue_broadcast_v1(row.tournament_id,'visibility',pg_current_xact_id()::text);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
