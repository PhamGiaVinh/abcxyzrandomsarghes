-- Pending G03 satellite clock read. Apply after G02 registration.
-- No initial clock or schedule is created. No browser grants.
BEGIN;

ALTER TABLE public.online_poker_tables
  ADD COLUMN IF NOT EXISTS is_satellite boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS online_satellite_private.table_clocks (
  table_id uuid PRIMARY KEY REFERENCES public.online_poker_tables(id),
  pilot_id uuid NOT NULL UNIQUE REFERENCES online_satellite_private.pilots(id),
  elapsed_seconds numeric(20,6) NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0 AND elapsed_seconds <> 'NaN'::numeric),
  running_since timestamptz CHECK (pg_catalog.isfinite(running_since)),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE IF NOT EXISTS online_satellite_private.blind_levels (
  pilot_id uuid NOT NULL REFERENCES online_satellite_private.pilots(id),
  starts_at_second bigint NOT NULL CHECK (starts_at_second >= 0),
  small_blind bigint NOT NULL CHECK (small_blind > 0),
  big_blind bigint NOT NULL CHECK (big_blind >= small_blind),
  big_blind_ante bigint NOT NULL CHECK (big_blind_ante >= 0),
  PRIMARY KEY (pilot_id, starts_at_second)
);

ALTER TABLE online_satellite_private.table_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_satellite_private.blind_levels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON online_satellite_private.table_clocks, online_satellite_private.blind_levels
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.op_read_satellite_deal_level(p_table_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN t.club_id IS DISTINCT FROM p.club_id OR l.starts_at_second IS NULL
        THEN jsonb_build_object('mode', 'unavailable')
      WHEN p_actor_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.clubs club
        LEFT JOIN online_satellite_private.registration_gate gate ON gate.club_id=club.id
        WHERE club.id=p.club_id AND (
          club.owner_id=p_actor_user_id OR (
            gate.delegated_td_actor_id=p_actor_user_id AND gate.delegated_by=club.owner_id
            AND EXISTS (SELECT 1 FROM public.club_floors f
              WHERE f.club_id=club.id AND f.user_id=p_actor_user_id)
          )
        )
      ) THEN jsonb_build_object('mode', 'unavailable')
      WHEN c.running_since IS NULL OR c.running_since > statement_timestamp()
        THEN jsonb_build_object('mode', 'paused')
      ELSE jsonb_build_object(
        'mode', 'ready',
        'clockRevision', c.revision::text,
        'levelStartSecond', l.starts_at_second::text,
        'sb', l.small_blind::text,
        'bb', l.big_blind::text,
        'bigBlindAnte', l.big_blind_ante::text
      )
    END
    FROM online_satellite_private.table_clocks c
    JOIN online_satellite_private.pilots p ON p.id = c.pilot_id
    JOIN public.online_poker_tables t ON t.id = c.table_id
    LEFT JOIN LATERAL (
      SELECT starts_at_second, small_blind, big_blind, big_blind_ante
      FROM online_satellite_private.blind_levels
      WHERE pilot_id = c.pilot_id AND starts_at_second <= c.elapsed_seconds
        + GREATEST(0, extract(epoch FROM statement_timestamp() - c.running_since))
      ORDER BY starts_at_second DESC
      LIMIT 1
    ) l ON true
    WHERE c.table_id = p_table_id
  ), jsonb_build_object('mode', CASE WHEN EXISTS (
    SELECT 1 FROM public.online_poker_tables WHERE id=p_table_id AND is_satellite
  ) THEN 'unavailable' ELSE 'practice' END));
$$;

REVOKE ALL ON FUNCTION public.op_read_satellite_deal_level(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_read_satellite_deal_level(uuid,uuid) TO service_role;

-- Called by the service-owned deal writer before it locks seats or the clock.
-- Role changes wait until a deal that passed this check has committed.
CREATE FUNCTION public.op_lock_satellite_manual_dealer(p_table_id uuid, p_actor_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  pilot_club uuid;
  club_owner uuid;
  gate online_satellite_private.registration_gate%ROWTYPE;
BEGIN
  SELECT p.club_id INTO pilot_club
  FROM online_satellite_private.table_clocks c
  JOIN online_satellite_private.pilots p ON p.id=c.pilot_id
  WHERE c.table_id=p_table_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT c.owner_id INTO club_owner FROM public.clubs c WHERE c.id=pilot_club FOR SHARE;
  IF p_actor_user_id=club_owner THEN RETURN true; END IF;
  SELECT g.* INTO gate FROM online_satellite_private.registration_gate g
    WHERE g.club_id=pilot_club FOR SHARE;
  IF NOT FOUND OR p_actor_user_id IS DISTINCT FROM gate.delegated_td_actor_id
    OR club_owner IS DISTINCT FROM gate.delegated_by THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.club_floors f WHERE f.club_id=pilot_club AND f.user_id=p_actor_user_id FOR SHARE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.op_lock_satellite_manual_dealer(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
