BEGIN;
ALTER TABLE tracker_analytics_v1.config ADD COLUMN hands_done boolean NOT NULL DEFAULT false;
ALTER TABLE tracker_analytics_v1.config ADD COLUMN results_done boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.process_public_hud_metadata_v1(p_kind text,p_entity uuid,p_generation bigint,p_lease uuid)
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

CREATE FUNCTION public.backfill_public_hud_v1(p_limit integer DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg tracker_analytics_v1.config; row record; walked integer:=0; last_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  SELECT * INTO cfg FROM tracker_analytics_v1.config WHERE singleton FOR UPDATE;
  IF cfg.backfill_complete THEN RETURN jsonb_build_object('complete',true); END IF;
  UPDATE tracker_analytics_v1.config SET backfill_started_at=coalesce(backfill_started_at,clock_timestamp()) WHERE singleton;
  IF NOT cfg.hands_done THEN
    FOR row IN SELECT id FROM public.tournament_hands WHERE cfg.backfill_hand_cursor IS NULL OR id>cfg.backfill_hand_cursor ORDER BY id LIMIT p_limit LOOP
      PERFORM tracker_analytics_v1.enqueue('hand',row.id,true); walked:=walked+1; last_id:=row.id;
    END LOOP;
    UPDATE tracker_analytics_v1.config SET backfill_hand_cursor=coalesce(last_id,backfill_hand_cursor),hands_done=walked<p_limit WHERE singleton;
  ELSIF NOT cfg.results_done THEN
    FOR row IN SELECT id FROM public.player_results WHERE cfg.backfill_result_cursor IS NULL OR id>cfg.backfill_result_cursor ORDER BY id LIMIT p_limit LOOP
      PERFORM tracker_analytics_v1.enqueue('result',row.id,true); walked:=walked+1; last_id:=row.id;
    END LOOP;
    UPDATE tracker_analytics_v1.config SET backfill_result_cursor=coalesce(last_id,backfill_result_cursor),results_done=walked<p_limit WHERE singleton;
  END IF;
  UPDATE tracker_analytics_v1.config SET backfill_complete=true WHERE singleton AND hands_done AND results_done
    AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs);
  RETURN (SELECT jsonb_build_object('complete',backfill_complete,'handsDone',hands_done,'resultsDone',results_done,'enqueued',walked)
    FROM tracker_analytics_v1.config WHERE singleton);
END $$;
REVOKE ALL ON FUNCTION public.process_public_hud_metadata_v1(text,uuid,bigint,uuid),public.backfill_public_hud_v1(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_public_hud_metadata_v1(text,uuid,bigint,uuid),public.backfill_public_hud_v1(integer) TO service_role;
COMMIT;
