-- Pending G04 shared clock read and commit check. Requires round membership.
BEGIN;

CREATE OR REPLACE FUNCTION public.op_read_satellite_deal_level(p_table_id uuid, p_actor_user_id uuid DEFAULT NULL)
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
      WHEN m.table_id IS NOT NULL AND permit.round_no IS NULL
        THEN jsonb_build_object('mode', 'waiting_for_round')
      WHEN m.table_id IS NULL AND c.qualification_slots >= (
        SELECT count(*) FROM public.online_poker_seats s
        WHERE s.table_id=c.table_id AND s.user_id IS NOT NULL AND s.stack>0
      ) THEN jsonb_build_object('mode', 'qualification_reached')
      ELSE jsonb_build_object(
        'mode', 'ready',
        'clockRevision', c.revision::text,
        'levelStartSecond', l.starts_at_second::text,
        'sb', l.small_blind::text,
        'bb', l.big_blind::text,
        'bigBlindAnte', l.big_blind_ante::text
      ) || CASE WHEN m.table_id IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('roundNo',permit.round_no::text) END
    END
    FROM online_satellite_private.table_clocks c
    JOIN online_satellite_private.pilots p ON p.id = c.pilot_id
    LEFT JOIN online_satellite_private.round_tables m ON m.table_id = p_table_id
    JOIN public.online_poker_tables t ON t.id = p_table_id
    LEFT JOIN LATERAL (
      SELECT r.round_no FROM online_satellite_private.round_deals r
      WHERE r.pilot_id=c.pilot_id AND r.table_id=p_table_id AND r.hand_id IS NULL
        AND r.round_no=(SELECT max(d.round_no) FROM online_satellite_private.round_deals d WHERE d.pilot_id=c.pilot_id)
    ) permit ON true
    LEFT JOIN LATERAL (
      SELECT starts_at_second, small_blind, big_blind, big_blind_ante
      FROM online_satellite_private.blind_levels
      WHERE pilot_id = c.pilot_id AND starts_at_second <= c.elapsed_seconds
        + GREATEST(0, extract(epoch FROM statement_timestamp() - c.running_since))
      ORDER BY starts_at_second DESC
      LIMIT 1
    ) l ON true
    WHERE (m.table_id IS NULL AND c.table_id=p_table_id) OR c.pilot_id=m.pilot_id
  ), jsonb_build_object('mode', CASE WHEN EXISTS (
    SELECT 1 FROM public.online_poker_tables WHERE id=p_table_id AND is_satellite
  ) THEN 'unavailable' ELSE 'practice' END));
$$;

REVOKE ALL ON FUNCTION public.op_read_satellite_deal_level(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_read_satellite_deal_level(uuid,uuid) TO service_role;

-- Called by the service-owned deal writer before it locks seats or the clock.
-- Role changes wait until a deal that passed this check has committed.
CREATE OR REPLACE FUNCTION public.op_lock_satellite_manual_dealer(p_table_id uuid, p_actor_user_id uuid)
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
  LEFT JOIN online_satellite_private.round_tables m ON m.table_id=p_table_id
  WHERE (m.table_id IS NULL AND c.table_id=p_table_id) OR c.pilot_id=m.pilot_id;
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

CREATE OR REPLACE FUNCTION public.op_check_satellite_deal_level()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  clock_row online_satellite_private.table_clocks%ROWTYPE;
  level_row online_satellite_private.blind_levels%ROWTYPE;
  deal_time timestamptz;
  config jsonb := NEW.state->'config';
  round_pilot uuid;
  expected jsonb := NEW.state->'satelliteLevel';
BEGIN
  SELECT m.pilot_id INTO round_pilot FROM online_satellite_private.round_tables m
    WHERE m.table_id = NEW.table_id;
  SELECT c.* INTO clock_row FROM online_satellite_private.table_clocks c
    WHERE (round_pilot IS NULL AND c.table_id=NEW.table_id) OR c.pilot_id=round_pilot FOR SHARE;
  IF NOT FOUND THEN
    IF expected IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.online_poker_tables WHERE id=NEW.table_id AND is_satellite
    ) THEN
      RAISE EXCEPTION 'online_satellite_deal_not_bound' USING ERRCODE = '23514';
    END IF;
    NEW.satellite_deal_level := NULL;
    RETURN NEW;
  END IF;

  deal_time := pg_catalog.clock_timestamp();
  IF clock_row.running_since IS NULL OR deal_time < clock_row.running_since THEN
    RAISE EXCEPTION 'online_satellite_clock_not_running' USING ERRCODE = '23514';
  END IF;
  IF round_pilot IS NULL AND clock_row.qualification_slots IS NOT NULL AND clock_row.qualification_slots >= (
    SELECT count(*) FROM public.online_poker_seats s
    WHERE s.table_id=NEW.table_id AND s.user_id IS NOT NULL AND s.stack>0
  ) THEN
    RAISE EXCEPTION 'online_satellite_qualification_reached' USING ERRCODE = '23514';
  END IF;
  SELECT l.* INTO level_row FROM online_satellite_private.blind_levels l
    WHERE l.pilot_id = clock_row.pilot_id
      AND l.starts_at_second <= clock_row.elapsed_seconds
        + extract(epoch FROM deal_time - clock_row.running_since)
    ORDER BY l.starts_at_second DESC LIMIT 1;
  IF NOT FOUND OR expected IS DISTINCT FROM jsonb_build_object(
      'clockRevision', clock_row.revision::text, 'levelStartSecond', level_row.starts_at_second::text)
    OR (config->>'sb')::bigint IS DISTINCT FROM level_row.small_blind
    OR (config->>'bb')::bigint IS DISTINCT FROM level_row.big_blind
    OR COALESCE((config->>'bigBlindAnte')::bigint, 0) IS DISTINCT FROM level_row.big_blind_ante THEN
    RAISE EXCEPTION 'online_satellite_stale_deal_level' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM online_satellite_private.pilots p JOIN public.online_poker_tables t
      ON t.id = NEW.table_id AND t.club_id = p.club_id
    WHERE p.id = clock_row.pilot_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.state->'seats') s
    WHERE NOT EXISTS (
      SELECT 1 FROM online_satellite_private.entries e WHERE e.pilot_id = clock_row.pilot_id
        AND e.player_user_id = (s->>'playerId')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'online_satellite_deal_roster_invalid' USING ERRCODE = '23514';
  END IF;
  NEW.satellite_deal_level := jsonb_build_object(
    'clockRevision', clock_row.revision::text,
    'levelStartSecond', level_row.starts_at_second::text,
    'sb', level_row.small_blind::text,
    'bb', level_row.big_blind::text,
    'bigBlindAnte', level_row.big_blind_ante::text
  );
  NEW.state := NEW.state - 'satelliteLevel';
  RETURN NEW;
END;
$$;

COMMIT;
