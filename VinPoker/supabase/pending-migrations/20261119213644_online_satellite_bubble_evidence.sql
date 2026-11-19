-- Pending: expose the last settled hand evidence to the pilot manager.
-- This query makes no placement, ticket, or shared game-state writes.
BEGIN;

CREATE FUNCTION public.get_online_satellite_bubble_evidence_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH scope AS (
    SELECT public.get_online_satellite_table_v1(p_pilot_id) AS data
  ), latest AS (
    SELECT h.id,h.hand_no,h.state_version,h.status,h.table_id
    FROM scope JOIN public.online_poker_hands h ON h.table_id=(scope.data->>'tableId')::uuid
    WHERE scope.data->'canManage' = 'true'::jsonb
    ORDER BY h.hand_no DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'handId',id,'handNo',hand_no::text,'stateVersion',state_version,'status',status,
    'survivingCount', CASE WHEN status='complete' THEN (
      SELECT count(*) FROM public.online_poker_seats s
      WHERE s.table_id=latest.table_id AND s.status='sitting' AND s.stack>0
    ) END,
    'eliminations', CASE WHEN status='complete' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('seat',s.seat_no,'startingStack',s.starting_stack::text)
        ORDER BY s.seat_no)
      FROM public.online_poker_hand_seats s
      WHERE s.hand_id=latest.id AND s.starting_stack>0 AND s.stack=0
    ),'[]'::jsonb) END
  )
  FROM latest;
$$;

REVOKE ALL ON FUNCTION public.get_online_satellite_bubble_evidence_v1(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_online_satellite_bubble_evidence_v1(uuid) TO authenticated;

COMMIT;
