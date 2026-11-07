-- Guarded reverse for isolated recovery verification; not the normal runtime rollback.
-- Runtime rollback first disables prepared reads and worker dispatch. Execute this
-- reverse only after separately approved source quiescence and an empty queue.
-- Preserve source, audit, contributions and totals; restore exact prior functions.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tracker_analytics_v1.config WHERE enabled OR worker_enabled)
 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs) THEN RAISE EXCEPTION 'HUD reverse requires disabled reads/worker and empty queue'; END IF;
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.visibility_changed()'::regprocedure),chr(13),'')) IS DISTINCT FROM '1b3320cd0f08d14fde3f081c5b132246'
 OR md5(replace(pg_get_functiondef('public.process_public_hud_metadata_v1(text,uuid,bigint,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'ac3c705ee94ca18024759124088a15e8'
 OR md5(replace(pg_get_functiondef('public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure),chr(13),'')) IS DISTINCT FROM '9bb2728bff8e77d32d8c92e55bafe9a4' THEN RAISE EXCEPTION 'HUD reverse postimage differs'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='tracker_analytics_v1.jobs'::regclass AND a.attname='refresh_hidden_only' AND NOT a.attisdropped
   AND a.atttypid='boolean'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)='false')
 OR md5(pg_get_indexdef(to_regclass('tracker_analytics_v1.hand_contributions_hidden_policy_idx')))
   IS DISTINCT FROM 'a1057f4c33eed89d5509f1206c06ae33'
 OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('tracker_analytics_v1.hand_contributions_hidden_policy_idx') AND indisvalid AND indisready)
 THEN RAISE EXCEPTION 'HUD reverse catalog differs'; END IF;
END $$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.visibility_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO tracker_analytics_v1.visibility_barriers(tournament_id) VALUES(coalesce(NEW.id,OLD.id))
  ON CONFLICT(tournament_id) DO UPDATE SET changed_at=clock_timestamp();
  PERFORM tracker_analytics_v1.enqueue('visibility',coalesce(NEW.id,OLD.id));
  IF TG_OP='UPDATE' AND ((OLD.status IN ('live','final_table','completed','finished'))
    IS DISTINCT FROM (NEW.status IN ('live','final_table','completed','finished'))) THEN
    UPDATE tracker_analytics_v1.jobs SET refresh_hands=true,progress_cursor=NULL
      WHERE kind='visibility' AND entity_id=NEW.id;
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;

CREATE OR REPLACE FUNCTION public.process_public_hud_metadata_v1(p_kind text,p_entity uuid,p_generation bigint,p_lease uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job tracker_analytics_v1.jobs; old tracker_analytics_v1.result_contributions;
  source public.player_results; target record; player uuid; v_version text; desired boolean; count_rows integer:=0;
  queued integer:=0; last_hand uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_kind='result' THEN PERFORM id FROM public.player_results WHERE id=p_entity FOR SHARE;
  ELSIF p_kind='visibility' THEN PERFORM id FROM public.tournaments WHERE id=p_entity FOR SHARE;
  ELSE RAISE EXCEPTION 'invalid_kind'; END IF;
  SELECT * INTO job FROM tracker_analytics_v1.jobs WHERE kind=p_kind AND entity_id=p_entity FOR UPDATE;
  IF NOT FOUND OR job.generation<>p_generation OR job.lease_token IS DISTINCT FROM p_lease
    OR job.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  SELECT c.version INTO v_version FROM tracker_analytics_v1.config c WHERE singleton;
  IF p_kind='result' THEN
    SELECT * INTO old FROM tracker_analytics_v1.result_contributions WHERE result_id=p_entity AND version=v_version;
    SELECT * INTO source FROM public.player_results WHERE id=p_entity;
    FOR player IN SELECT id FROM (SELECT old.player_id id UNION SELECT source.player_id) x WHERE id IS NOT NULL ORDER BY id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('public-hud:'||player::text,0));
      INSERT INTO tracker_analytics_v1.player_totals(player_id,version) VALUES(player,v_version) ON CONFLICT DO NOTHING;
    END LOOP;
    IF old.result_id IS NOT NULL THEN
      UPDATE tracker_analytics_v1.player_totals SET winnings=winnings-old.prize,result_count=result_count-1,
        revision=nextval('tracker_analytics_v1.revision_seq'),computed_at=clock_timestamp()
        WHERE player_id=old.player_id AND player_totals.version=old.version;
      DELETE FROM tracker_analytics_v1.result_contributions WHERE result_id=p_entity AND version=v_version;
    END IF;
    IF source.id IS NOT NULL AND source.verified_by_admin THEN
      IF source.prize<0 OR source.prize<>trunc(source.prize) OR source.prize>9007199254740991 THEN RAISE EXCEPTION 'invalid_verified_prize'; END IF;
      INSERT INTO tracker_analytics_v1.result_contributions(result_id,player_id,prize,version,tournament_name,event_date,position,total_entries)
      VALUES(p_entity,source.player_id,source.prize,v_version,source.tournament_name,source.event_date,source.position,source.total_entries);
      UPDATE tracker_analytics_v1.player_totals SET winnings=winnings+source.prize,result_count=result_count+1,
        revision=nextval('tracker_analytics_v1.revision_seq'),computed_at=clock_timestamp()
        WHERE player_id=source.player_id AND player_totals.version=v_version;
    END IF;
  ELSE
    desired:=EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_entity AND deleted_at IS NULL);
    FOR target IN SELECT * FROM tracker_analytics_v1.tournament_totals
      WHERE tournament_id=p_entity AND included<>desired ORDER BY player_id,version LIMIT 200 LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('public-hud:'||target.player_id::text,0));
      SELECT * INTO target FROM tracker_analytics_v1.tournament_totals WHERE tournament_id=p_entity AND player_id=target.player_id AND tournament_totals.version=target.version AND included<>desired FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      INSERT INTO tracker_analytics_v1.player_totals(player_id,version) VALUES(target.player_id,target.version) ON CONFLICT DO NOTHING;
      UPDATE tracker_analytics_v1.player_totals SET
        numerators=tracker_analytics_v1.vector_add(numerators,target.numerators,CASE WHEN desired THEN 1 ELSE -1 END),
        denominators=tracker_analytics_v1.vector_add(denominators,target.denominators,CASE WHEN desired THEN 1 ELSE -1 END),
        missing_proof=tracker_analytics_v1.vector_add(missing_proof,target.missing_proof,CASE WHEN desired THEN 1 ELSE -1 END),
        public_hands=public_hands+target.public_hands*(CASE WHEN desired THEN 1 ELSE -1 END),
        observed_hands=observed_hands+target.observed_hands*(CASE WHEN desired THEN 1 ELSE -1 END),
        omitted_hands=omitted_hands+target.omitted_hands*(CASE WHEN desired THEN 1 ELSE -1 END),
        revision=nextval('tracker_analytics_v1.revision_seq'),computed_at=clock_timestamp()
        WHERE player_id=target.player_id AND player_totals.version=target.version;
      UPDATE tracker_analytics_v1.tournament_totals SET included=desired
        WHERE tournament_id=p_entity AND player_id=target.player_id AND tournament_totals.version=target.version;
      count_rows:=count_rows+1;
    END LOOP;
    IF count_rows=200 THEN
      UPDATE tracker_analytics_v1.jobs SET lease_token=NULL,lease_until=NULL,available_at=clock_timestamp() WHERE kind=p_kind AND entity_id=p_entity;
      RETURN true;
    END IF;
    IF job.refresh_hands THEN
      FOR target IN SELECT id FROM public.tournament_hands WHERE tournament_id=p_entity
        AND (job.progress_cursor IS NULL OR id>job.progress_cursor) ORDER BY id LIMIT 200 LOOP
        PERFORM tracker_analytics_v1.enqueue('hand',target.id,true);
        queued:=queued+1;last_hand:=target.id;
      END LOOP;
      UPDATE tracker_analytics_v1.jobs SET progress_cursor=coalesce(last_hand,progress_cursor)
        WHERE kind=p_kind AND entity_id=p_entity;
      IF queued=200 OR EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs j
        JOIN public.tournament_hands h ON h.id=j.entity_id WHERE j.kind='hand' AND h.tournament_id=p_entity) THEN
        UPDATE tracker_analytics_v1.jobs SET lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+interval '1 second'
          WHERE kind=p_kind AND entity_id=p_entity;
        RETURN true;
      END IF;
    END IF;
    DELETE FROM tracker_analytics_v1.visibility_barriers WHERE tournament_id=p_entity;
  END IF;
  DELETE FROM tracker_analytics_v1.jobs WHERE kind=p_kind AND entity_id=p_entity;
  RETURN true;
END $$;


CREATE OR REPLACE FUNCTION public.publish_public_hud_hand_v1(
  p_entity uuid,p_generation bigint,p_lease uuid,p_fingerprint text,p_rows jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job tracker_analytics_v1.jobs; old tracker_analytics_v1.hand_contributions; row jsonb;
  source public.tournament_hands;
  player uuid; tour uuid; v_version text; n bigint[]; d bigint[]; m bigint[]; observed bigint; omitted bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  -- Source before queue: matches source-writer -> trigger enqueue lock order.
  PERFORM id FROM public.tournament_hands WHERE id=p_entity FOR SHARE;
  SELECT * INTO job FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=p_entity FOR UPDATE;
  IF NOT FOUND OR job.generation<>p_generation OR job.lease_token IS DISTINCT FROM p_lease
    OR job.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  IF p_fingerprint IS DISTINCT FROM tracker_analytics_v1.hand_fingerprint(p_entity) THEN RETURN false; END IF;
  SELECT c.version INTO v_version FROM tracker_analytics_v1.config c WHERE singleton;
  SELECT * INTO source FROM public.tournament_hands WHERE id=p_entity;
  tour:=source.tournament_id;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>16 THEN RAISE EXCEPTION 'invalid_contributions'; END IF;
  IF jsonb_array_length(p_rows)<>(SELECT count(DISTINCT x->>'playerId') FROM jsonb_array_elements(p_rows) x) THEN RAISE EXCEPTION 'duplicate_contribution'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE NOT EXISTS(
    SELECT 1 FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id
    WHERE hp.hand_id=p_entity AND hp.tournament_id=h.tournament_id AND hp.player_id=(x->>'playerId')::uuid AND h.status='completed' AND NOT coalesce(h.is_voided,false)))
    THEN RAISE EXCEPTION 'contribution_out_of_scope'; END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=p_entity AND status='completed' AND NOT coalesce(is_voided,false))
    AND (SELECT count(DISTINCT player_id) FROM public.hand_players WHERE hand_id=p_entity AND tournament_id=source.tournament_id)<>jsonb_array_length(p_rows)
    THEN RAISE EXCEPTION 'incomplete_contributions'; END IF;
  FOR player IN SELECT id FROM (
    SELECT player_id id FROM tracker_analytics_v1.hand_contributions WHERE hand_id=p_entity
    UNION SELECT (x->>'playerId')::uuid FROM jsonb_array_elements(p_rows) x
  ) participants ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('public-hud:'||player::text,0));
  END LOOP;
  FOR old IN SELECT * FROM tracker_analytics_v1.hand_contributions WHERE hand_id=p_entity AND version=v_version ORDER BY player_id,tournament_id LOOP
    PERFORM tracker_analytics_v1.apply_hand_delta(old.player_id,old.tournament_id,old.version,
      old.numerators,old.denominators,old.missing_proof,old.public_hands,old.observed_hands,old.omitted_hands,-1);
  END LOOP;
  DELETE FROM tracker_analytics_v1.hand_contributions WHERE hand_id=p_entity AND version=v_version;
  FOR row IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'playerId' LOOP
    player:=(row->>'playerId')::uuid;
    SELECT array_agg(value::bigint ORDER BY ordinality) INTO n FROM jsonb_array_elements_text(row->'numerators') WITH ORDINALITY;
    SELECT array_agg(value::bigint ORDER BY ordinality) INTO d FROM jsonb_array_elements_text(row->'denominators') WITH ORDINALITY;
    SELECT array_agg(value::bigint ORDER BY ordinality) INTO m FROM jsonb_array_elements_text(row->'missingProof') WITH ORDINALITY;
    observed:=(row->>'handsObserved')::bigint; omitted:=(row->>'omittedHands')::bigint;
    IF NOT tracker_analytics_v1.valid_vector(n) OR NOT tracker_analytics_v1.valid_vector(d) OR NOT tracker_analytics_v1.valid_vector(m)
      OR observed NOT IN (0,1) OR omitted NOT IN (0,1) OR observed+omitted<>1 OR (row->>'publicHands')::bigint<>1
      OR EXISTS(SELECT 1 FROM generate_series(1,22) i WHERE n[i]>d[i] OR m[i]>observed) THEN RAISE EXCEPTION 'invalid_counters'; END IF;
    INSERT INTO tracker_analytics_v1.hand_contributions(hand_id,player_id,tournament_id,version,source_fingerprint,settlement_evidence,
      source_revision,played_at,hand_number,table_id,session_id,numerators,denominators,missing_proof,public_hands,observed_hands,omitted_hands)
      VALUES(p_entity,player,tour,v_version,p_fingerprint,jsonb_build_object(
        'policyEligible',EXISTS(SELECT 1 FROM public.tournaments WHERE id=tour AND deleted_at IS NULL AND status IN ('live','final_table','completed','finished')),
        'latest',(SELECT jsonb_build_object('sourceRevision',o.source_revision::text,'settlementRevision',o.settlement_revision::text,'status',o.status,'schemaVersion',o.public_outcome->>'schemaVersion')
          FROM public.tournament_settlement_outcomes o WHERE o.hand_id=p_entity ORDER BY o.settlement_revision DESC,o.id DESC LIMIT 1),
        'publicVerified',(SELECT jsonb_build_object('sourceRevision',o.source_revision::text,'settlementRevision',o.settlement_revision::text,'status',o.status,'schemaVersion',o.public_outcome->>'schemaVersion')
          FROM public.tournament_settlement_outcomes o WHERE o.hand_id=p_entity AND o.source_revision=source.source_revision AND o.status='verified' ORDER BY o.settlement_revision DESC,o.id DESC LIMIT 1)),
        source.source_revision,source.hand_time,source.hand_number,
        source.tournament_table_id,source.table_session_id,n,d,m,1,observed,omitted);
    PERFORM tracker_analytics_v1.apply_hand_delta(player,tour,v_version,n,d,m,1,observed,omitted,1);
  END LOOP;
  DELETE FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=p_entity;
  RETURN true;
END $$;


DROP INDEX tracker_analytics_v1.hand_contributions_hidden_policy_idx;
ALTER TABLE tracker_analytics_v1.jobs DROP COLUMN refresh_hidden_only;
COMMIT;
