-- G04: expose the current round only to TDs of this pilot.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_online_satellite_table_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'tableId',resolved.id,'clockRevision',c.revision::text,'running',c.running_since IS NOT NULL,
    'status',CASE WHEN resolved.id IS NULL AND multi.enabled THEN 'unassigned'
      WHEN multi.enabled AND resolved.status='open' AND c.running_since IS NULL THEN 'paused'
      ELSE COALESCE(resolved.status,'unprovisioned') END,
    'canManage',access.can_manage,'canPlay',access.can_play AND (NOT multi.enabled OR assigned.id IS NOT NULL),
    'canProvision',c.table_id IS NULL AND NOT multi.enabled AND access.can_manage AND COALESCE(g.enabled,false)
      AND p.registration_closes_at <= statement_timestamp()
  ) || CASE WHEN c.qualification_slots IS NULL OR multi.enabled THEN '{}'::jsonb
    ELSE jsonb_build_object('qualificationReached',c.qualification_slots >= (
      SELECT count(*) FROM public.online_poker_seats s
      WHERE s.table_id=c.table_id AND s.user_id IS NOT NULL AND s.stack>0
    )) END || CASE WHEN multi.enabled AND access.can_manage THEN jsonb_build_object('roundNo',
      (SELECT coalesce(max(d.round_no),0)::text FROM online_satellite_private.round_deals d WHERE d.pilot_id=p.id))
    ELSE '{}'::jsonb END
  FROM online_satellite_private.pilots p
  JOIN public.clubs club ON club.id=p.club_id
  LEFT JOIN online_satellite_private.table_clocks c ON c.pilot_id=p.id
  LEFT JOIN online_satellite_private.registration_gate g ON g.club_id=p.club_id
  CROSS JOIN (SELECT auth.uid() AS actor) caller
  CROSS JOIN LATERAL (
    SELECT COALESCE(caller.actor = club.owner_id OR (
      caller.actor = g.delegated_td_actor_id AND g.delegated_by = club.owner_id
      AND EXISTS (SELECT 1 FROM public.club_floors f WHERE f.club_id=p.club_id AND f.user_id=caller.actor)
    ),false) AS can_manage,
    EXISTS (SELECT 1 FROM online_satellite_private.entries e
      WHERE e.pilot_id=p.id AND e.player_user_id=caller.actor) AS can_play
  ) access
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM online_satellite_private.round_tables m WHERE m.pilot_id=p.id) AS enabled
  ) multi
  LEFT JOIN LATERAL (
    SELECT (array_agg(m.table_id))[1] AS id
    FROM online_satellite_private.round_tables m
    JOIN public.online_poker_tables t ON t.id=m.table_id AND t.club_id=p.club_id AND t.is_satellite
    JOIN public.online_poker_seats s ON s.table_id=m.table_id AND s.user_id=caller.actor
    WHERE m.pilot_id=p.id AND access.can_play
    HAVING count(*)=1
  ) assigned ON multi.enabled
  LEFT JOIN public.online_poker_tables resolved ON resolved.club_id=p.club_id
    AND resolved.id=CASE WHEN NOT multi.enabled THEN c.table_id
      WHEN assigned.id IS NOT NULL THEN assigned.id
      WHEN access.can_manage THEN c.table_id END
  WHERE p.id=p_pilot_id AND caller.actor IS NOT NULL AND (access.can_manage OR access.can_play)
    AND (multi.enabled OR c.table_id IS NULL OR resolved.id IS NOT NULL);
$$;
COMMIT;
