-- Fenced, service-only projection worker. Does not settle/repair source hands.
BEGIN;
CREATE FUNCTION tracker_analytics_v1.hand_fingerprint(p_hand uuid) RETURNS text
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

CREATE FUNCTION public.claim_public_hud_jobs_v1(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_limit NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
  WITH due AS (
    SELECT kind,entity_id FROM tracker_analytics_v1.jobs
    WHERE available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
    ORDER BY priority,oldest_pending_at,kind,entity_id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE tracker_analytics_v1.jobs j SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '15 seconds',attempts=attempts+1
    FROM due WHERE (j.kind,j.entity_id)=(due.kind,due.entity_id)
    RETURNING j.kind,j.entity_id,j.generation,j.lease_token
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END $$;

CREATE FUNCTION public.get_public_hud_job_source_v1(p_kind text,p_entity uuid,p_generation bigint,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h public.tournament_hands; proof jsonb; players jsonb; actions jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind=p_kind AND entity_id=p_entity
    AND generation=p_generation AND lease_token=p_lease AND lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'lease_expired'; END IF;
  IF p_kind='hand' THEN
    SELECT * INTO h FROM public.tournament_hands WHERE id=p_entity;
    IF NOT FOUND THEN RETURN jsonb_build_object('fingerprint',tracker_analytics_v1.hand_fingerprint(p_entity),'hand',NULL); END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'seat_number',seat_number,'starting_stack',starting_stack)
      ORDER BY seat_number,player_id,entry_number),'[]'::jsonb) INTO players FROM public.hand_players WHERE hand_id=p_entity;
    SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'street',street,'action_type',action_type,
      'action_amount',action_amount,'action_order',action_order) ORDER BY action_order,id),'[]'::jsonb)
      INTO actions FROM public.hand_actions WHERE hand_id=p_entity;
    proof:=public.get_public_tournament_settlement(p_entity);
    -- Match the legacy classifiers' evidence gate. Malformed proof is unknown,
    -- never a verified loss/empty winner set.
    IF jsonb_typeof(proof->'pots')='array' AND jsonb_typeof(proof->'handRanks')='array' THEN
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'pots') p WHERE jsonb_typeof(p->'winnerIds') IS DISTINCT FROM 'array')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'handRanks') r WHERE jsonb_typeof(r->'playerId') IS DISTINCT FROM 'string') THEN
        proof:=NULL;
      END IF;
    END IF;
    RETURN jsonb_build_object('fingerprint',tracker_analytics_v1.hand_fingerprint(p_entity),'tournamentId',h.tournament_id,
      'hand',jsonb_build_object('handId',h.id,'status',h.status,'isVoided',coalesce(h.is_voided,false),
      'buttonSeat',h.button_seat,'boardCardCount',jsonb_array_length(coalesce(to_jsonb(h.community_cards),'[]'::jsonb)),
      'players',players,'actions',actions,'settlement',CASE WHEN proof->>'schemaVersion'='settlement-outcome-v1'
        AND proof->>'status'='verified' AND jsonb_typeof(proof->'pots')='array' AND jsonb_typeof(proof->'handRanks')='array'
        THEN jsonb_build_object('verified',true,'current',true,
          'winnerPlayerIds',coalesce((SELECT jsonb_agg(DISTINCT w.winner) FROM jsonb_array_elements(proof->'pots') p
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p->'winnerIds')='array' THEN p->'winnerIds' ELSE '[]'::jsonb END) w(winner)),'[]'::jsonb),
          'eligiblePlayerIds',coalesce((SELECT jsonb_agg(r->>'playerId') FROM jsonb_array_elements(proof->'handRanks') r),'[]'::jsonb),
          'showdown',jsonb_array_length(proof->'handRanks')>=2) ELSE NULL END));
  ELSIF p_kind='result' THEN
    RETURN jsonb_build_object('result',(SELECT jsonb_build_object('playerId',player_id,'prize',prize,'verified',verified_by_admin)
      FROM public.player_results WHERE id=p_entity));
  ELSIF p_kind='visibility' THEN
    RETURN jsonb_build_object('included',EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_entity AND deleted_at IS NULL));
  END IF;
  RAISE EXCEPTION 'invalid_kind';
END $$;

CREATE FUNCTION public.publish_public_hud_hand_v1(
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
    WHERE hp.hand_id=p_entity AND hp.player_id=(x->>'playerId')::uuid AND h.status='completed' AND NOT coalesce(h.is_voided,false)))
    THEN RAISE EXCEPTION 'contribution_out_of_scope'; END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=p_entity AND status='completed' AND NOT coalesce(is_voided,false))
    AND (SELECT count(DISTINCT player_id) FROM public.hand_players WHERE hand_id=p_entity)<>jsonb_array_length(p_rows)
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
    INSERT INTO tracker_analytics_v1.hand_contributions(hand_id,player_id,tournament_id,version,source_fingerprint,
      source_revision,played_at,hand_number,table_id,session_id,numerators,denominators,missing_proof,public_hands,observed_hands,omitted_hands)
      VALUES(p_entity,player,tour,v_version,p_fingerprint,source.source_revision,source.hand_time,source.hand_number,
        source.tournament_table_id,source.table_session_id,n,d,m,1,observed,omitted);
    PERFORM tracker_analytics_v1.apply_hand_delta(player,tour,v_version,n,d,m,1,observed,omitted,1);
  END LOOP;
  DELETE FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=p_entity;
  RETURN true;
END $$;

CREATE FUNCTION public.fail_public_hud_job_v1(p_kind text,p_entity uuid,p_generation bigint,p_lease uuid,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE tracker_analytics_v1.jobs SET lease_token=NULL,lease_until=NULL,error_code=left(p_error,64),
    available_at=clock_timestamp()+make_interval(secs=>least(60,power(2,least(attempts,6))::integer))
    WHERE kind=p_kind AND entity_id=p_entity AND generation=p_generation AND lease_token=p_lease;
  RETURN FOUND;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tracker_analytics_v1 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_public_hud_jobs_v1(integer),
  public.get_public_hud_job_source_v1(text,uuid,bigint,uuid),
  public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb),
  public.fail_public_hud_job_v1(text,uuid,bigint,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_hud_jobs_v1(integer),
  public.get_public_hud_job_source_v1(text,uuid,bigint,uuid),
  public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb),
  public.fail_public_hud_job_v1(text,uuid,bigint,uuid,text) TO service_role;
COMMIT;
