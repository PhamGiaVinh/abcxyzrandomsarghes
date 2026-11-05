BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('public.flush_public_spectator_broadcast_v2(integer)'::regprocedure),chr(13),''))<>'e5439d6d813079754d9f2d55ef8a7d48' OR md5(replace(pg_get_functiondef('tracker_analytics_v1.broadcast_withdrawal_v1()'::regprocedure),chr(13),''))<>'59860fa9484c0f48b70044f51c2380cf' THEN RAISE EXCEPTION 'hand withdrawal recovery drift'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.flush_public_spectator_broadcast_v2(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row record; components jsonb; revisions jsonb; revocations jsonb; sent integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 -- One tournament advisory lock prevents two flushers splitting a component set.
 FOR row IN SELECT DISTINCT tournament_id FROM spectator_projection_v2.broadcast_pending_v1 ORDER BY tournament_id LIMIT p_limit LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public-broadcast:'||row.tournament_id::text,0)) THEN CONTINUE; END IF;
  WITH locked AS MATERIALIZED (SELECT * FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id=row.tournament_id ORDER BY component,source_txid LIMIT 500 FOR UPDATE SKIP LOCKED),
   removed AS (DELETE FROM spectator_projection_v2.broadcast_pending_v1 p USING locked l
    WHERE p.tournament_id=l.tournament_id AND p.component=l.component AND p.source_txid=l.source_txid RETURNING p.*)
   SELECT jsonb_agg(DISTINCT component ORDER BY component),jsonb_object_agg(component,revision ORDER BY changed_at,source_txid)
    INTO components,revisions FROM removed;
  IF components IS NULL THEN CONTINUE; END IF;
  PERFORM realtime.send(jsonb_build_object('tournamentId',row.tournament_id,'components',components,'revisions',revisions),'changed','public:tournament-viewer-v2:'||row.tournament_id::text,false);
  sent:=sent+1;
 END LOOP;
 IF pg_try_advisory_xact_lock(hashtextextended('public-hud-revocation',0)) THEN
  SELECT jsonb_agg(source_txid::text ORDER BY source_txid) INTO revocations FROM
   (SELECT source_txid FROM tracker_analytics_v1.revocation_broadcast_v1 ORDER BY source_txid LIMIT 500 FOR UPDATE SKIP LOCKED) r;
  IF revocations IS NOT NULL THEN
   PERFORM realtime.send(jsonb_build_object('scope','all-public-player-hud','revision',md5(revocations::text)),
    'revoked','public:player-hud-access-v1',false);
   DELETE FROM tracker_analytics_v1.revocation_broadcast_v1 WHERE source_txid::text IN (SELECT jsonb_array_elements_text(revocations));
  END IF;
 END IF;
 RETURN sent;
END $$;
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
