-- Pending. A clock command changes eligibility for the next deal, while
-- the current hand keeps its level and action deadline.
BEGIN;

CREATE FUNCTION public.set_online_satellite_clock_v1(
  p_pilot_id uuid, p_expected_revision bigint, p_running boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  club_owner uuid;
  gate online_satellite_private.registration_gate%ROWTYPE;
  clock_row online_satellite_private.table_clocks%ROWTYPE;
  table_status text;
  bound_table uuid;
  pilot_club uuid;
  now_at timestamptz;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT p.club_id, c.table_id INTO pilot_club, bound_table
    FROM online_satellite_private.pilots p
    JOIN online_satellite_private.table_clocks c ON c.pilot_id=p.id
    WHERE p.id=p_pilot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT owner_id INTO club_owner FROM public.clubs WHERE id=pilot_club FOR SHARE;
  SELECT g.* INTO gate FROM online_satellite_private.registration_gate g WHERE g.club_id=pilot_club FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  IF actor IS DISTINCT FROM club_owner THEN
    IF actor IS DISTINCT FROM gate.delegated_td_actor_id OR club_owner IS DISTINCT FROM gate.delegated_by THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.club_floors WHERE club_id=pilot_club AND user_id=actor FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SATELLITE_PILOT_MANAGER_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  IF p_running IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_BAD_CLOCK_COMMAND' USING ERRCODE='22023';
  END IF;
  IF p_running AND (NOT gate.enabled OR NOT public.op_is_enabled()) THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  -- Deal locks seats, then table, then clock. This command never takes seat locks.
  SELECT status INTO table_status FROM public.online_poker_tables
    WHERE id=bound_table AND club_id=pilot_club FOR UPDATE;
  IF NOT FOUND OR table_status='closed' THEN
    RAISE EXCEPTION 'SATELLITE_PILOT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT clock_row FROM online_satellite_private.table_clocks
    WHERE table_id=bound_table FOR UPDATE;
  IF p_expected_revision IS DISTINCT FROM clock_row.revision THEN
    RETURN jsonb_build_object('outcome','stale','revision',clock_row.revision::text,
      'running',clock_row.running_since IS NOT NULL);
  END IF;
  IF p_running IS DISTINCT FROM (clock_row.running_since IS NOT NULL) THEN
    now_at := pg_catalog.clock_timestamp();
    UPDATE online_satellite_private.table_clocks SET
      elapsed_seconds = clock_row.elapsed_seconds + CASE WHEN p_running THEN 0
        ELSE GREATEST(0,extract(epoch FROM now_at - clock_row.running_since)) END,
      running_since = CASE WHEN p_running THEN now_at ELSE NULL END,
      revision = clock_row.revision+1
    WHERE table_id=bound_table RETURNING * INTO clock_row;
    UPDATE public.online_poker_tables SET status=CASE WHEN p_running THEN 'open' ELSE 'paused' END
    WHERE id=bound_table;
  END IF;
  RETURN jsonb_build_object('outcome','ok','revision',clock_row.revision::text,
    'running',clock_row.running_since IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.set_online_satellite_clock_v1(uuid,bigint,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_online_satellite_clock_v1(uuid,bigint,boolean) TO authenticated;

COMMIT;
