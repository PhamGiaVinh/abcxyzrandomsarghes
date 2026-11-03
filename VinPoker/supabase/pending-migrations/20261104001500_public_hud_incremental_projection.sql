-- CRITICAL: private, rebuildable analytics projection. Not a money/game writer.
-- Production apply/worker activation requires the exact reviewed release package.
-- Rollback: disable config and dispatcher, restore public endpoint release; retain
-- source/audit rows and these derived rows for diagnosis. Never restore game data.
BEGIN;
CREATE SCHEMA tracker_analytics_v1;
REVOKE ALL ON SCHEMA tracker_analytics_v1 FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA tracker_analytics_v1 TO service_role;
CREATE SEQUENCE tracker_analytics_v1.revision_seq;

CREATE TABLE tracker_analytics_v1.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  -- This schema/worker is one algorithm contract. A replacement contract must
  -- build in a separate private schema and keep this worker running through
  -- cutover/rollback; changing a string must never rewrite active history.
  version text NOT NULL DEFAULT 'public-hud-projection-v1' CHECK(version='public-hud-projection-v1'),
  enabled boolean NOT NULL DEFAULT false,
  backfill_complete boolean NOT NULL DEFAULT false,
  backfill_started_at timestamptz,
  backfill_hand_cursor uuid,
  backfill_result_cursor uuid
);
INSERT INTO tracker_analytics_v1.config(singleton) VALUES(true);

CREATE FUNCTION tracker_analytics_v1.zeros() RETURNS bigint[]
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT array_fill(0::bigint,ARRAY[22]) $$;
CREATE FUNCTION tracker_analytics_v1.vector_add(a bigint[],b bigint[],direction integer DEFAULT 1)
RETURNS bigint[] LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
  SELECT array_agg(a[i]+b[i]*direction ORDER BY i) FROM generate_series(1,22) i
$$;
CREATE FUNCTION tracker_analytics_v1.valid_vector(v bigint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(array_ndims(v)=1 AND array_lower(v,1)=1 AND cardinality(v)=22
    AND NOT EXISTS(SELECT 1 FROM unnest(v) n WHERE n IS NULL OR n<0 OR n>9007199254740991),false)
$$;

CREATE TABLE tracker_analytics_v1.hand_contributions (
  hand_id uuid NOT NULL, player_id uuid NOT NULL, tournament_id uuid NOT NULL,
  version text NOT NULL, source_fingerprint text NOT NULL,
  settlement_evidence jsonb NOT NULL,
  source_revision bigint NOT NULL, played_at timestamptz, hand_number integer NOT NULL,
  table_id uuid, session_id uuid,
  numerators bigint[] NOT NULL, denominators bigint[] NOT NULL, missing_proof bigint[] NOT NULL,
  public_hands bigint NOT NULL, observed_hands bigint NOT NULL, omitted_hands bigint NOT NULL,
  PRIMARY KEY(hand_id,player_id,version),
  CHECK(tracker_analytics_v1.valid_vector(numerators)),
  CHECK(tracker_analytics_v1.valid_vector(denominators)),
  CHECK(tracker_analytics_v1.valid_vector(missing_proof)),
  CHECK(public_hands=observed_hands+omitted_hands AND public_hands=1 AND observed_hands>=0 AND omitted_hands>=0)
);
CREATE INDEX hud_contribution_player ON tracker_analytics_v1.hand_contributions(player_id,tournament_id,hand_id);
CREATE INDEX hud_history_page ON tracker_analytics_v1.hand_contributions(player_id,tournament_id,version,played_at DESC NULLS LAST,hand_id DESC);

CREATE TABLE tracker_analytics_v1.tournament_totals (
  tournament_id uuid NOT NULL, player_id uuid NOT NULL, version text NOT NULL,
  included boolean NOT NULL,
  numerators bigint[] NOT NULL DEFAULT tracker_analytics_v1.zeros(),
  denominators bigint[] NOT NULL DEFAULT tracker_analytics_v1.zeros(),
  missing_proof bigint[] NOT NULL DEFAULT tracker_analytics_v1.zeros(),
  public_hands bigint NOT NULL DEFAULT 0, observed_hands bigint NOT NULL DEFAULT 0, omitted_hands bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(tournament_id,player_id,version),
  CHECK(tracker_analytics_v1.valid_vector(numerators)),
  CHECK(tracker_analytics_v1.valid_vector(denominators)),
  CHECK(tracker_analytics_v1.valid_vector(missing_proof)),
  CHECK(public_hands=observed_hands+omitted_hands AND observed_hands>=0 AND omitted_hands>=0)
);
CREATE INDEX hud_tour_totals_player ON tracker_analytics_v1.tournament_totals(player_id,tournament_id,version);
CREATE TABLE tracker_analytics_v1.player_totals (
  player_id uuid NOT NULL, version text NOT NULL,
  numerators bigint[] NOT NULL DEFAULT tracker_analytics_v1.zeros(),
  denominators bigint[] NOT NULL DEFAULT tracker_analytics_v1.zeros(),
  missing_proof bigint[] NOT NULL DEFAULT tracker_analytics_v1.zeros(),
  public_hands bigint NOT NULL DEFAULT 0, observed_hands bigint NOT NULL DEFAULT 0, omitted_hands bigint NOT NULL DEFAULT 0,
  winnings numeric(30,0) NOT NULL DEFAULT 0, result_count bigint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT nextval('tracker_analytics_v1.revision_seq'),
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(player_id,version),
  CHECK(tracker_analytics_v1.valid_vector(numerators)),
  CHECK(tracker_analytics_v1.valid_vector(denominators)),
  CHECK(tracker_analytics_v1.valid_vector(missing_proof)),
  CHECK(public_hands=observed_hands+omitted_hands AND observed_hands>=0 AND omitted_hands>=0 AND winnings>=0 AND result_count>=0)
);
CREATE TABLE tracker_analytics_v1.result_contributions (
  result_id uuid NOT NULL, player_id uuid NOT NULL, prize bigint NOT NULL CHECK(prize>=0), version text NOT NULL,
  PRIMARY KEY(result_id,version)
);
CREATE INDEX hud_result_player ON tracker_analytics_v1.result_contributions(player_id);

CREATE TABLE tracker_analytics_v1.jobs (
  kind text NOT NULL CHECK(kind IN ('hand','result','visibility')),
  entity_id uuid NOT NULL,
  generation bigint NOT NULL DEFAULT 1,
  priority smallint NOT NULL DEFAULT 0,
  oldest_pending_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid, lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  refresh_hands boolean NOT NULL DEFAULT false,
  progress_cursor uuid,
  PRIMARY KEY(kind,entity_id),
  CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX hud_jobs_ready ON tracker_analytics_v1.jobs(priority,oldest_pending_at,kind,entity_id) INCLUDE(available_at,lease_until);
CREATE TABLE tracker_analytics_v1.job_players (
  kind text NOT NULL, entity_id uuid NOT NULL, player_id uuid NOT NULL,
  hard_block boolean NOT NULL DEFAULT false,
  PRIMARY KEY(kind,entity_id,player_id),
  FOREIGN KEY(kind,entity_id) REFERENCES tracker_analytics_v1.jobs(kind,entity_id) ON DELETE CASCADE
);
CREATE INDEX hud_pending_player ON tracker_analytics_v1.job_players(player_id,hard_block);
CREATE TABLE tracker_analytics_v1.visibility_barriers (
  tournament_id uuid PRIMARY KEY, changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Only derived counters change here. Every aggregate mutation follows a stable
-- player/tournament lock order established by the publishing RPC.
CREATE FUNCTION tracker_analytics_v1.apply_hand_delta(
  p_player uuid,p_tournament uuid,p_version text,p_n bigint[],p_d bigint[],p_m bigint[],
  p_public bigint,p_observed bigint,p_omitted bigint,p_direction integer
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE included_now boolean;
BEGIN
  IF p_direction NOT IN (-1,1) THEN RAISE EXCEPTION 'invalid_direction'; END IF;
  INSERT INTO tracker_analytics_v1.tournament_totals(tournament_id,player_id,version,included)
    SELECT p_tournament,p_player,p_version,EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament AND t.deleted_at IS NULL)
    ON CONFLICT DO NOTHING;
  UPDATE tracker_analytics_v1.tournament_totals SET
    numerators=tracker_analytics_v1.vector_add(numerators,p_n,p_direction),
    denominators=tracker_analytics_v1.vector_add(denominators,p_d,p_direction),
    missing_proof=tracker_analytics_v1.vector_add(missing_proof,p_m,p_direction),
    public_hands=public_hands+p_public*p_direction,observed_hands=observed_hands+p_observed*p_direction,
    omitted_hands=omitted_hands+p_omitted*p_direction
    WHERE tournament_id=p_tournament AND player_id=p_player AND version=p_version RETURNING included INTO included_now;
  IF included_now THEN
    INSERT INTO tracker_analytics_v1.player_totals(player_id,version) VALUES(p_player,p_version) ON CONFLICT DO NOTHING;
    UPDATE tracker_analytics_v1.player_totals SET
      numerators=tracker_analytics_v1.vector_add(numerators,p_n,p_direction),
      denominators=tracker_analytics_v1.vector_add(denominators,p_d,p_direction),
      missing_proof=tracker_analytics_v1.vector_add(missing_proof,p_m,p_direction),
      public_hands=public_hands+p_public*p_direction,observed_hands=observed_hands+p_observed*p_direction,
      omitted_hands=omitted_hands+p_omitted*p_direction,
      revision=nextval('tracker_analytics_v1.revision_seq'),computed_at=clock_timestamp()
      WHERE player_id=p_player AND version=p_version;
  END IF;
END $$;

CREATE FUNCTION tracker_analytics_v1.enqueue(p_kind text,p_entity uuid,p_backfill boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_entity IS NULL THEN RETURN; END IF;
  IF p_kind='hand' AND NOT EXISTS(SELECT 1 FROM public.tournament_hands WHERE id=p_entity AND status='completed')
    AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=p_entity)
    AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.hand_contributions WHERE hand_id=p_entity) THEN RETURN; END IF;
  INSERT INTO tracker_analytics_v1.jobs(kind,entity_id,priority) VALUES(p_kind,p_entity,CASE WHEN p_backfill THEN 10 ELSE 0 END)
  ON CONFLICT(kind,entity_id) DO UPDATE SET generation=tracker_analytics_v1.jobs.generation+1,
    priority=least(tracker_analytics_v1.jobs.priority,excluded.priority),available_at=clock_timestamp(),
    lease_token=NULL,lease_until=NULL,attempts=0,error_code=NULL;
  IF p_kind='hand' THEN
    INSERT INTO tracker_analytics_v1.job_players(kind,entity_id,player_id,hard_block)
    SELECT p_kind,p_entity,affected.player_id,bool_or(affected.blocked) FROM (
      SELECT player_id,false AS blocked FROM public.hand_players WHERE hand_id=p_entity
      UNION ALL SELECT c.player_id,NOT EXISTS(
        SELECT 1 FROM public.tournament_hands h JOIN public.hand_players hp ON hp.hand_id=h.id
        WHERE h.id=p_entity AND h.tournament_id=c.tournament_id AND hp.tournament_id=c.tournament_id AND hp.player_id=c.player_id
          AND h.status='completed' AND NOT coalesce(h.is_voided,false))
      FROM tracker_analytics_v1.hand_contributions c WHERE c.hand_id=p_entity
    ) affected GROUP BY affected.player_id
    ON CONFLICT(kind,entity_id,player_id) DO UPDATE SET hard_block=tracker_analytics_v1.job_players.hard_block OR excluded.hard_block;
  ELSIF p_kind='result' THEN
    INSERT INTO tracker_analytics_v1.job_players(kind,entity_id,player_id,hard_block)
    SELECT p_kind,p_entity,affected.player_id,bool_or(affected.blocked) FROM (
      SELECT c.player_id,NOT EXISTS(SELECT 1 FROM public.player_results r WHERE r.id=p_entity
        AND r.player_id=c.player_id AND r.verified_by_admin) AS blocked
      FROM tracker_analytics_v1.result_contributions c WHERE c.result_id=p_entity
      UNION ALL SELECT player_id,false FROM public.player_results WHERE id=p_entity
    ) affected GROUP BY affected.player_id
    ON CONFLICT(kind,entity_id,player_id) DO UPDATE SET hard_block=tracker_analytics_v1.job_players.hard_block OR excluded.hard_block;
  END IF;
END $$;

CREATE FUNCTION tracker_analytics_v1.hand_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.status<>'completed' THEN RETURN NEW; END IF;
  -- A new in-progress hand has no contribution. If a completed hand was
  -- reopened, its removal job remains present until subtraction commits.
  IF TG_OP='UPDATE' AND NEW.status<>'completed' AND OLD.status<>'completed'
    AND NOT EXISTS(SELECT 1 FROM tracker_analytics_v1.jobs WHERE kind='hand' AND entity_id=NEW.id) THEN RETURN NEW; END IF;
  PERFORM tracker_analytics_v1.enqueue('hand',coalesce(NEW.id,OLD.id));RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER hud_hand_changed AFTER INSERT OR DELETE OR UPDATE OF source_revision,tournament_id,hand_time,hand_number,status,is_voided
  ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION tracker_analytics_v1.hand_changed();
CREATE FUNCTION tracker_analytics_v1.outcome_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM tracker_analytics_v1.enqueue('hand',OLD.hand_id); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM tracker_analytics_v1.enqueue('hand',NEW.hand_id); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER hud_outcome_changed AFTER INSERT OR UPDATE OR DELETE ON public.tournament_settlement_outcomes
  FOR EACH ROW EXECUTE FUNCTION tracker_analytics_v1.outcome_changed();
CREATE FUNCTION tracker_analytics_v1.result_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM tracker_analytics_v1.enqueue('result',coalesce(NEW.id,OLD.id)); RETURN coalesce(NEW,OLD); END $$;
CREATE TRIGGER hud_result_changed AFTER INSERT OR UPDATE OR DELETE ON public.player_results
  FOR EACH ROW EXECUTE FUNCTION tracker_analytics_v1.result_changed();
CREATE FUNCTION tracker_analytics_v1.visibility_changed() RETURNS trigger
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
CREATE TRIGGER hud_visibility_changed AFTER DELETE OR UPDATE OF deleted_at,status ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION tracker_analytics_v1.visibility_changed();

-- All new functions default-deny. Public/worker RPCs are granted individually
-- in the next migration after their actor/scope/fencing contracts are defined.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='tracker_analytics_v1' LOOP
    EXECUTE format('ALTER TABLE tracker_analytics_v1.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA tracker_analytics_v1 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tracker_analytics_v1 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA tracker_analytics_v1 TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA tracker_analytics_v1 TO service_role;
COMMIT;
