-- G04: extend existing restrictive SELECT policies to the assigned table.
BEGIN;
CREATE OR REPLACE FUNCTION online_satellite_private.can_read_poker_table(p_table_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH round_membership AS (
    SELECT m.pilot_id FROM online_satellite_private.round_tables m WHERE m.table_id = p_table_id
  ), single_table AS (
    SELECT c.pilot_id FROM online_satellite_private.table_clocks c WHERE c.table_id = p_table_id
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM round_membership) THEN EXISTS (
      SELECT 1
      FROM round_membership m
      JOIN online_satellite_private.pilots p ON p.id = m.pilot_id
      JOIN public.online_poker_tables t ON t.id = p_table_id AND t.club_id = p.club_id AND t.is_satellite
      JOIN online_satellite_private.entries e ON e.pilot_id = m.pilot_id
      JOIN public.online_poker_seats s ON s.table_id = t.id AND s.user_id = e.player_user_id
      WHERE e.player_user_id = (SELECT auth.uid())
    )
    WHEN EXISTS (SELECT 1 FROM single_table) THEN EXISTS (
      SELECT 1 FROM single_table m
      JOIN online_satellite_private.entries e ON e.pilot_id = m.pilot_id
      WHERE e.player_user_id = (SELECT auth.uid())
    )
    ELSE NOT EXISTS (
      SELECT 1 FROM public.online_poker_tables t WHERE t.id = p_table_id AND t.is_satellite
    )
  END;
$$;
COMMIT;
