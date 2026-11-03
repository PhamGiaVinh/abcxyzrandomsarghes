-- CRITICAL. Compact component generations and durable batched Broadcast.
-- Source business tables, source writers, visibility and payout masks are retained.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE spectator_projection_v2.entity_markers ADD COLUMN source_txid xid8;
CREATE TABLE spectator_projection_v2.compact_generation_originals_v1(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON spectator_projection_v2.compact_generation_originals_v1 FROM PUBLIC,anon,authenticated,service_role;
DO $guard$ DECLARE spec record; actual text; BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('spectator_projection_v2.mark_dirty(uuid,text,text,text)','5275ae9972ac43651bd1b831b52332dd'),
    ('publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb)','82639431db23cb8e1d2fe3314206207d'),
    ('get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb)','240f85c7e29a710f084bbbd04f30d5d7'),
    ('get_public_spectator_projection_source_v2(uuid,text,uuid)','e6e14c1039b762482e170a119736c0ed'),
    ('dispatch_public_spectator_projection_v2()','6197c05a6983eeb841b01a88ac8ceff1'),
    ('spectator_projection_v2.mark_row_dirty()','34ebfad5c2bea4d3306d67d435fe02a6'),
    ('spectator_projection_v2.mark_hand_child_dirty()','e9df156b6ee5d6a22ba968257ae38852')) x(signature,hash) LOOP
    actual:=replace(pg_get_functiondef(spec.signature::regprocedure),chr(13),'');
    IF md5(actual)<>spec.hash THEN RAISE EXCEPTION 'spectator_generation_catalog_drift: %',spec.signature; END IF;
    INSERT INTO spectator_projection_v2.compact_generation_originals_v1 VALUES(spec.signature,actual);
  END LOOP;
END $guard$;
CREATE TABLE spectator_projection_v2.broadcast_pending_v1(
 tournament_id uuid NOT NULL,component text NOT NULL,revision text NOT NULL,
 source_txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tournament_id,component,source_txid));
ALTER TABLE spectator_projection_v2.broadcast_pending_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.broadcast_pending_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION spectator_projection_v2.queue_broadcast_v1(p_tournament uuid,p_component text,p_revision text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO spectator_projection_v2.broadcast_pending_v1(tournament_id,component,revision) VALUES(p_tournament,p_component,p_revision)
 ON CONFLICT(tournament_id,component,source_txid) DO UPDATE SET revision=excluded.revision,changed_at=clock_timestamp()
$$;
REVOKE ALL ON FUNCTION spectator_projection_v2.queue_broadcast_v1(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE spectator_projection_v2.deferred_generations_v1(
 tournament_id uuid NOT NULL,component text NOT NULL,source_txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tournament_id,component,source_txid));
CREATE TABLE tracker_analytics_v1.revocation_broadcast_v1(source_txid xid8 PRIMARY KEY DEFAULT pg_current_xact_id());
ALTER TABLE spectator_projection_v2.deferred_generations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_analytics_v1.revocation_broadcast_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spectator_projection_v2.deferred_generations_v1,tracker_analytics_v1.revocation_broadcast_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION tracker_analytics_v1.queue_revocation_v1() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO tracker_analytics_v1.revocation_broadcast_v1 DEFAULT VALUES ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION tracker_analytics_v1.queue_revocation_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_dirty(p_tournament_id uuid,p_component text,p_entity_key text,p_group_key text DEFAULT 'event') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generation bigint; already_marked boolean;
BEGIN
 IF p_tournament_id IS NULL OR p_component NOT IN ('tables','ranking','payout','visibility') THEN RETURN; END IF;
 SELECT source_txid=pg_current_xact_id() INTO already_marked FROM spectator_projection_v2.entity_markers
  WHERE tournament_id=p_tournament_id AND component=p_component AND entity_key='generation';
 -- Readers cannot observe intermediate writes in this transaction. One bump
 -- fences the complete committed component, regardless of how many rows change.
 IF already_marked THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament_id) THEN
  PERFORM spectator_projection_v2.queue_broadcast_v1(p_tournament_id,'visibility',pg_current_xact_id()::text);
  PERFORM tracker_analytics_v1.queue_revocation_v1();RETURN;
 END IF;
 -- Never wait on another source transaction while holding business-row locks.
 -- Contending transactions append their own invalidation; API freshness and
 -- publication fences see it immediately, before a worker absorbs it.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('public-gen:'||p_tournament_id::text,0)) THEN
  IF EXISTS(SELECT 1 FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=p_tournament_id AND component=p_component AND source_txid=pg_current_xact_id()) THEN RETURN; END IF;
  INSERT INTO spectator_projection_v2.deferred_generations_v1(tournament_id,component) VALUES(p_tournament_id,p_component) ON CONFLICT DO NOTHING;
  IF p_component='visibility' THEN
   PERFORM tracker_analytics_v1.queue_revocation_v1();
   PERFORM spectator_projection_v2.queue_broadcast_v1(p_tournament_id,'visibility',pg_current_xact_id()::text);
  END IF;
  RETURN;
 END IF;
 INSERT INTO spectator_projection_v2.entity_markers(tournament_id,component,entity_key,source_txid) VALUES(p_tournament_id,p_component,'generation',pg_current_xact_id())
 ON CONFLICT(tournament_id,component,entity_key) DO UPDATE SET source_revision=spectator_projection_v2.entity_markers.source_revision+1,source_changed_at=clock_timestamp(),source_txid=excluded.source_txid
 RETURNING source_revision INTO generation;
 INSERT INTO spectator_projection_v2.work_groups(tournament_id,component,group_key,dirty_ids,source_vector)
 VALUES(p_tournament_id,p_component,'component',jsonb_build_array(generation::text),jsonb_build_object('generation',generation::text))
 ON CONFLICT(tournament_id,component,group_key) DO UPDATE SET dirty_ids=excluded.dirty_ids,source_vector=excluded.source_vector,
 available_at=least(spectator_projection_v2.work_groups.available_at,excluded.available_at),claimed_until=NULL,fencing_token=NULL,attempts=0,last_error=NULL;
 IF p_component='visibility' THEN
  PERFORM tracker_analytics_v1.queue_revocation_v1();
  PERFORM spectator_projection_v2.queue_broadcast_v1(p_tournament_id,'visibility',generation::text);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_row_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_tour uuid; next_tour uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_TABLE_NAME='tournaments' THEN previous_tour:=OLD.id;ELSE previous_tour:=OLD.tournament_id;END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  IF TG_TABLE_NAME='tournaments' THEN next_tour:=NEW.id;ELSE next_tour:=NEW.tournament_id;END IF;
 END IF;
 IF previous_tour IS NOT NULL THEN PERFORM spectator_projection_v2.mark_dirty(previous_tour,TG_ARGV[0],'generation','component');END IF;
 IF next_tour IS DISTINCT FROM previous_tour THEN PERFORM spectator_projection_v2.mark_dirty(next_tour,TG_ARGV[0],'generation','component');END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_hand_child_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_hand uuid;next_hand uuid;tour uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN previous_hand:=OLD.hand_id;END IF;
 IF TG_OP<>'DELETE' THEN next_hand:=NEW.hand_id;END IF;
 IF previous_hand IS NOT NULL THEN
  SELECT tournament_id INTO tour FROM public.tournament_hands WHERE id=previous_hand;
  PERFORM spectator_projection_v2.mark_dirty(tour,'tables','generation','component');
 END IF;
 IF next_hand IS DISTINCT FROM previous_hand THEN
  SELECT tournament_id INTO tour FROM public.tournament_hands WHERE id=next_hand;
  PERFORM spectator_projection_v2.mark_dirty(tour,'tables','generation','component');
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;

CREATE FUNCTION public.absorb_public_spectator_generations_v2(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tour record; item record; processed integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 FOR tour IN SELECT DISTINCT tournament_id FROM spectator_projection_v2.deferred_generations_v1 ORDER BY tournament_id LIMIT p_limit LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public-gen:'||tour.tournament_id::text,0)) THEN CONTINUE; END IF;
  FOR item IN SELECT * FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=tour.tournament_id ORDER BY component,source_txid LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
   IF EXISTS(SELECT 1 FROM public.tournaments WHERE id=tour.tournament_id) THEN
    PERFORM spectator_projection_v2.mark_dirty(tour.tournament_id,item.component,'generation','component');
   END IF;
   DELETE FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=item.tournament_id AND component=item.component AND source_txid=item.source_txid;
   processed:=processed+1;
  END LOOP;
 END LOOP;
 RETURN processed;
END $$;
REVOKE ALL ON FUNCTION public.absorb_public_spectator_generations_v2(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.absorb_public_spectator_generations_v2(integer) TO service_role;

-- Transform only the generation lookup. Keep the reviewed public gates and the
-- current cashier-confirmed payout mask byte-for-byte in the captured body.
DO $rewrite$ DECLARE spec record; body text; changed text; BEGIN
 FOR spec IN SELECT * FROM spectator_projection_v2.compact_generation_originals_v1 WHERE signature LIKE 'get_public_%' OR signature LIKE 'publish_public_%' LOOP
  body:=spec.definition;
  changed:=regexp_replace(body,'m\.component\s*=\s*(p_component|v_component)','m.component=\1 AND m.entity_key=''generation''','g');
  IF changed=body THEN RAISE EXCEPTION 'generation_rewrite_missing: %',spec.signature; END IF;
  IF spec.signature LIKE 'get_public_spectator_projection_source_v2%' THEN
   changed:=replace(changed,'  SELECT COALESCE(jsonb_object_agg(',
    '  IF EXISTS(SELECT 1 FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=p_tournament_id AND component=p_component) THEN RAISE EXCEPTION ''source_pending''; END IF; SELECT COALESCE(jsonb_object_agg(');
  ELSIF spec.signature LIKE 'get_public_tournament_viewer_snapshot_v2%' THEN
   changed:=replace(changed,'    v_payload:=COALESCE(v_pub.payload,',
    '    v_oldest:=least(v_oldest,(SELECT min(changed_at) FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=p_tournament_id AND component=v_component)); v_payload:=COALESCE(v_pub.payload,');
   changed:=replace(changed,'v_source_vector IS DISTINCT FROM COALESCE(v_pub.source_vector,''{}''::jsonb) THEN',
    '(v_source_vector IS DISTINCT FROM COALESCE(v_pub.source_vector,''{}''::jsonb) OR v_oldest IS NOT NULL) THEN');
   changed:=replace(changed,'AND v_source_vector=COALESCE(v_pub.source_vector,''{}''::jsonb);',
    'AND v_source_vector=COALESCE(v_pub.source_vector,''{}''::jsonb) AND v_oldest IS NULL;');
  END IF;
  IF spec.signature LIKE 'publish_public_spectator_projection_v2%' THEN
   changed:=replace(changed,'IF v_current IS DISTINCT FROM p_source_vector THEN',
    'IF v_current IS DISTINCT FROM p_source_vector OR EXISTS(SELECT 1 FROM spectator_projection_v2.deferred_generations_v1 WHERE tournament_id=p_tournament_id AND component=p_component) THEN');
   changed:=replace(changed,'DECLARE v_current jsonb; v_notify boolean:=false;', 'DECLARE v_current jsonb; v_notify boolean:=false; v_revision text;');
   changed:=replace(changed, 'PERFORM realtime.send(jsonb_build_object(''tournamentId'',p_tournament_id),''changed'',''public:tournament-viewer-v2:''||p_tournament_id::text,false);','NULL;');
   changed:=replace(changed,'  RETURN true;', '  v_revision:=p_source_vector->>''generation''; PERFORM spectator_projection_v2.queue_broadcast_v1(p_tournament_id,p_component,v_revision); RETURN true;');
  END IF;
  EXECUTE changed;
 END LOOP;
END $rewrite$;
-- Pick one candidate from each indexed branch before comparing priorities.
-- Sorting the union of an entire table's completed history grows with hands.
DO $latest$ DECLARE body text; changed text; BEGIN
 body:=replace(pg_get_functiondef('public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure),chr(13),'');
 IF array_length(string_to_array(body,'SELECT th.*, ''live''::text AS display_state, 0 AS priority'),1)<>2
 OR array_length(string_to_array(body,'SELECT th.*, ''last_completed''::text AS display_state, 1 AS priority'),1)<>2 THEN
  RAISE EXCEPTION 'latest_hand_source_contract_drift';
 END IF;
 changed:=replace(body,'SELECT th.*, ''live''::text AS display_state, 0 AS priority','(SELECT th.*, ''live''::text AS display_state, 0 AS priority');
 changed:=replace(changed,'SELECT th.*, ''last_completed''::text AS display_state, 1 AS priority','(SELECT th.*, ''last_completed''::text AS display_state, 1 AS priority');
 changed:=regexp_replace(changed,'AND NOT COALESCE\(th\.is_voided, false\)([[:space:]]+)UNION ALL','AND NOT COALESCE(th.is_voided, false) ORDER BY th.created_at DESC,th.id DESC LIMIT 1)\1UNION ALL','g');
 changed:=regexp_replace(changed,'AND NOT COALESCE\(th\.is_voided, false\)([[:space:]]+)\) candidate','AND NOT COALESCE(th.is_voided, false) ORDER BY th.created_at DESC,th.id DESC LIMIT 1)\1) candidate','g');
 IF array_length(string_to_array(changed,'ORDER BY th.created_at DESC,th.id DESC LIMIT 1)'),1)<>3 THEN RAISE EXCEPTION 'latest_hand_source_rewrite_missing'; END IF;
 EXECUTE changed;
END $latest$;
DO $dispatch$ DECLARE body text; marker text; BEGIN
 SELECT definition INTO STRICT body FROM spectator_projection_v2.compact_generation_originals_v1 WHERE signature='dispatch_public_spectator_projection_v2()';
 marker:='IF NOT EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups w WHERE w.available_at<=clock_timestamp() AND (w.claimed_until IS NULL OR w.claimed_until<clock_timestamp())) THEN RETURN NULL; END IF;';
 IF position(marker IN body)=0 THEN RAISE EXCEPTION 'dispatch_generation_guard_missing'; END IF;
 EXECUTE replace(body,marker,'IF NOT EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups w WHERE w.available_at<=clock_timestamp() AND (w.claimed_until IS NULL OR w.claimed_until<clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM spectator_projection_v2.broadcast_pending_v1) AND NOT EXISTS(SELECT 1 FROM spectator_projection_v2.deferred_generations_v1) AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.revocation_broadcast_v1) THEN RETURN NULL; END IF;');
END $dispatch$;

CREATE FUNCTION public.flush_public_spectator_broadcast_v2(p_limit integer DEFAULT 100) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row record; components jsonb; revisions jsonb; locked_ids jsonb; revocations jsonb; sent integer:=0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 -- One tournament advisory lock prevents two flushers splitting a component set.
 FOR row IN SELECT DISTINCT tournament_id FROM spectator_projection_v2.broadcast_pending_v1 ORDER BY tournament_id LIMIT p_limit LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public-broadcast:'||row.tournament_id::text,0)) THEN CONTINUE; END IF;
  WITH locked AS MATERIALIZED (SELECT * FROM spectator_projection_v2.broadcast_pending_v1 WHERE tournament_id=row.tournament_id ORDER BY component FOR UPDATE SKIP LOCKED)
   SELECT jsonb_agg(DISTINCT component ORDER BY component),jsonb_object_agg(component,revision ORDER BY changed_at,source_txid),
    jsonb_agg(jsonb_build_array(component,source_txid::text)) INTO components,revisions,locked_ids FROM locked;
  IF components IS NULL THEN CONTINUE; END IF;
  PERFORM realtime.send(jsonb_build_object('tournamentId',row.tournament_id,'components',components,'revisions',revisions),'changed','public:tournament-viewer-v2:'||row.tournament_id::text,false);
  DELETE FROM spectator_projection_v2.broadcast_pending_v1 p WHERE p.tournament_id=row.tournament_id
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(locked_ids) x WHERE x->>0=p.component AND x->>1=p.source_txid::text);
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
REVOKE ALL ON FUNCTION public.flush_public_spectator_broadcast_v2(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.flush_public_spectator_broadcast_v2(integer) TO service_role;
-- Clock edits have their own signal; ordinary tournament edits do not revoke
-- every frozen HUD. Withdrawal/status transitions invalidate before projection.
INSERT INTO spectator_projection_v2.compact_generation_originals_v1
 SELECT 'trigger:spectator_v2_tournaments_dirty',pg_get_triggerdef(oid) FROM pg_trigger
 WHERE tgrelid='public.tournaments'::regclass AND tgname='spectator_v2_tournaments_dirty';
CREATE FUNCTION spectator_projection_v2.tournament_signal_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_row jsonb:=to_jsonb(OLD); after_row jsonb:=to_jsonb(NEW);
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM spectator_projection_v2.queue_broadcast_v1(OLD.id,'visibility',pg_current_xact_id()::text);
  PERFORM tracker_analytics_v1.queue_revocation_v1();
  RETURN OLD;
 END IF;
 IF TG_OP<>'UPDATE' OR before_row->'deleted_at' IS DISTINCT FROM after_row->'deleted_at'
   OR before_row->'status' IS DISTINCT FROM after_row->'status' THEN
  PERFORM spectator_projection_v2.mark_dirty(coalesce(NEW.id,OLD.id),'visibility','generation','component');
 END IF;
 IF TG_OP='UPDATE' AND (SELECT jsonb_object_agg(k,before_row->k) FROM unnest(ARRAY['current_level','current_level_id','clock_started_at','clock_paused_at','pause_accumulated']) k)
   IS DISTINCT FROM (SELECT jsonb_object_agg(k,after_row->k) FROM unnest(ARRAY['current_level','current_level_id','clock_started_at','clock_paused_at','pause_accumulated']) k) THEN
  PERFORM spectator_projection_v2.queue_broadcast_v1(NEW.id,'clock',pg_current_xact_id()::text);
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION spectator_projection_v2.tournament_signal_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER spectator_v2_tournaments_dirty ON public.tournaments;
CREATE TRIGGER spectator_v2_tournaments_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournaments
 FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.tournament_signal_v1();
CREATE FUNCTION tracker_analytics_v1.broadcast_withdrawal_v1() RETURNS trigger
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
REVOKE ALL ON FUNCTION tracker_analytics_v1.broadcast_withdrawal_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hud_withdrawal_broadcast AFTER INSERT OR UPDATE OF hard_block ON tracker_analytics_v1.job_players
 FOR EACH ROW WHEN (NEW.hard_block) EXECUTE FUNCTION tracker_analytics_v1.broadcast_withdrawal_v1();
-- Existing leases cannot publish into the new generation domain. Rebuild only
-- derived snapshots. Historical entity markers remain available for rollback.
DELETE FROM spectator_projection_v2.work_groups;
DO $$ DECLARE t record; c text; BEGIN
 FOR t IN SELECT id FROM public.tournaments WHERE deleted_at IS NULL LOOP
  FOREACH c IN ARRAY ARRAY['tables','ranking','payout','visibility'] LOOP
   PERFORM spectator_projection_v2.mark_dirty(t.id,c,'generation','component');
  END LOOP;
 END LOOP;
END $$;
COMMIT;
