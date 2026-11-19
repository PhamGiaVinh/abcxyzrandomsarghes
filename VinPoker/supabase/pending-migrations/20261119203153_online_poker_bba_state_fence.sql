-- Pending G03 opt-in BBA storage contract. No runtime switch or backfill.
-- The paired rollback is allowed only while disabled, idle and without v2 history.
BEGIN;

LOCK TABLE public.online_poker_config IN SHARE MODE NOWAIT;
LOCK TABLE public.online_poker_hands IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $$
BEGIN
  IF public.op_is_enabled() OR EXISTS (
    SELECT 1 FROM public.online_poker_hands WHERE status IN ('dealing','betting')
  ) THEN
    RAISE EXCEPTION 'online poker must be disabled and idle';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.op_preserve_bba_hand_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  config jsonb := NEW.state->'config';
  ante bigint;
  blind bigint;
  payer int;
  payer_count int;
  invalid_count int;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.state_schema_version IS DISTINCT FROM NEW.state_schema_version
    OR OLD.engine_version IS DISTINCT FROM NEW.engine_version
  ) THEN
    RAISE EXCEPTION 'online_poker_hand_version_changed' USING ERRCODE = '23514';
  END IF;

  IF NEW.state_schema_version = 1 THEN
    IF (config->>'schemaVersion')::int IS DISTINCT FROM 1
       OR config ?| ARRAY['bigBlindAnte','bigBlindAnteSeat']
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.state->'seats') s WHERE s ? 'deadAnte') THEN
      RAISE EXCEPTION 'online_poker_ante_requires_v2' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state_schema_version <> 2 OR (config->>'schemaVersion')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'online_poker_unsupported_hand_schema' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.state->'seats') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'online_poker_ante_seat_invalid' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.state->'seats') s GROUP BY (s->>'seat')::int HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'online_poker_ante_seat_invalid' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND config IS DISTINCT FROM OLD.state->'config' THEN
    RAISE EXCEPTION 'online_poker_ante_configuration_changed' USING ERRCODE = '23514';
  END IF;

  ante := (config->>'bigBlindAnte')::bigint;
  blind := (config->>'bb')::bigint;
  payer := (config->>'bigBlindAnteSeat')::int;
  IF ante IS NULL OR ante <= 0 OR blind IS NULL OR blind <= 0 OR payer IS NULL OR payer NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'online_poker_ante_configuration_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) FILTER (WHERE (s->>'seat')::int=payer),
         count(*) FILTER (WHERE
           (s->>'seat')::int IS NULL OR (s->>'seat')::int NOT BETWEEN 1 AND 10
           OR s->>'playerId' IS NULL OR s->>'startingStack' IS NULL
           OR s->>'totalCommitted' IS NULL OR s->>'committed' IS NULL
           OR COALESCE((s->>'deadAnte')::bigint,0) IS DISTINCT FROM
             CASE WHEN (s->>'seat')::int=payer
               THEN LEAST(ante,GREATEST(0,(s->>'startingStack')::bigint-blind)) ELSE 0 END
           OR COALESCE((s->>'deadAnte')::bigint,0) >
              (s->>'totalCommitted')::bigint-(s->>'committed')::bigint)
  INTO payer_count, invalid_count
  FROM jsonb_array_elements(NEW.state->'seats') s;
  IF payer_count <> 1 OR invalid_count <> 0 THEN
    RAISE EXCEPTION 'online_poker_ante_seat_invalid' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(OLD.state->'seats') o
    FULL JOIN jsonb_array_elements(NEW.state->'seats') n
      ON o->>'seat'=n->>'seat' AND o->>'playerId'=n->>'playerId'
    WHERE o IS NULL OR n IS NULL OR (o->'startingStack') IS DISTINCT FROM (n->'startingStack')
      OR (o->'deadAnte') IS DISTINCT FROM (n->'deadAnte')
  ) THEN
    RAISE EXCEPTION 'online_poker_ante_history_changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.op_preserve_bba_hand_state() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_op_preserve_bba_hand_state ON public.online_poker_hands;
CREATE TRIGGER trg_op_preserve_bba_hand_state
  BEFORE INSERT OR UPDATE OF state, state_schema_version, engine_version ON public.online_poker_hands
  FOR EACH ROW EXECUTE FUNCTION public.op_preserve_bba_hand_state();

COMMIT;
