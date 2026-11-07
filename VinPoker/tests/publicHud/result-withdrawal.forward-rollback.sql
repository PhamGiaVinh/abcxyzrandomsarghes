BEGIN;
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.broadcast_withdrawal_v1()'::regprocedure),chr(13),''))<>'80d94877352e8ad4bb86c3ffd6fa9c4e' THEN
  RAISE EXCEPTION 'HUD result withdrawal recovery preimage differs';
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
 ELSIF NEW.kind='result' THEN
  FOR row IN SELECT tournament_id FROM tracker_analytics_v1.tournament_totals WHERE player_id=NEW.player_id LOOP
   PERFORM spectator_projection_v2.queue_broadcast_v1(row.tournament_id,'visibility',pg_current_xact_id()::text);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
