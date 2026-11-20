-- G04: provide audited hand facts to the TD for an underfilled round.
BEGIN;
CREATE FUNCTION public.get_online_satellite_round_bubble_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH checkpoint AS (
    SELECT c.qualification_slots, max(d.round_no) AS round_no
    FROM online_satellite_private.table_clocks c
    JOIN online_satellite_private.round_deals d ON d.pilot_id=c.pilot_id
    WHERE c.pilot_id=p_pilot_id AND public.get_online_satellite_table_v1(p_pilot_id)->'canManage'='true'::jsonb
    GROUP BY c.qualification_slots
  ), facts AS (
    SELECT d.table_id, h.id AS hand_id, h.state_version, h.status, d.round_no
    FROM checkpoint c
    JOIN online_satellite_private.round_deals d ON d.pilot_id=p_pilot_id AND d.round_no=c.round_no
    LEFT JOIN public.online_poker_hands h ON h.id=d.hand_id AND h.table_id=d.table_id
  ), survivors AS (
    SELECT count(*) AS survivors
    FROM online_satellite_private.round_tables m
    JOIN public.online_poker_seats s ON s.table_id=m.table_id
    WHERE m.pilot_id=p_pilot_id AND s.user_id IS NOT NULL AND s.stack>0
  )
  SELECT jsonb_build_object('roundNo',c.round_no::text,'qualificationSlots',c.qualification_slots,
    'survivors',s.survivors,'unfilledSlots',c.qualification_slots-s.survivors,
    'hands',(SELECT jsonb_agg(jsonb_build_object('tableId',f.table_id,'handId',f.hand_id,
      'handVersion',f.state_version,'eliminations',COALESCE((
        SELECT jsonb_agg(jsonb_build_object('seatNo',hs.seat_no,'startingStack',hs.starting_stack::text)
          ORDER BY hs.seat_no)
        FROM public.online_poker_hand_seats hs
        WHERE hs.hand_id=f.hand_id AND hs.starting_stack>0 AND hs.stack=0
      ),'[]'::jsonb)) ORDER BY f.table_id) FROM facts f))
  FROM checkpoint c CROSS JOIN survivors s
  WHERE c.qualification_slots > s.survivors
    AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.status IS DISTINCT FROM 'complete')
    AND NOT EXISTS (SELECT 1 FROM online_satellite_private.locked_results r WHERE r.pilot_id=p_pilot_id);
$$;
REVOKE ALL ON FUNCTION public.get_online_satellite_round_bubble_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_online_satellite_round_bubble_v1(uuid) TO authenticated;
COMMIT;
