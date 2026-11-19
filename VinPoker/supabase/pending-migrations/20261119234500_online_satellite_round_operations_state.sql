-- G04: current table roster and round progress for the authorized TD.
BEGIN;
CREATE FUNCTION public.get_online_satellite_round_operations_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH authorized AS (
    SELECT p.id, p.club_id, c.running_since
    FROM online_satellite_private.pilots p
    JOIN online_satellite_private.table_clocks c ON c.pilot_id=p.id
    WHERE p.id=p_pilot_id AND public.get_online_satellite_table_v1(p.id)->'canManage'='true'::jsonb
  ), checkpoint AS (
    SELECT a.*, coalesce((SELECT max(d.round_no) FROM online_satellite_private.round_deals d
      WHERE d.pilot_id=a.id),0) AS round_no
    FROM authorized a
  )
  SELECT jsonb_build_object('roundNo',a.round_no::text,'tables',jsonb_agg(jsonb_build_object(
    'tableId',t.id,'name',t.name,'maxSeats',t.max_seats,
    'status',CASE WHEN t.status='open' AND a.running_since IS NULL THEN 'paused' ELSE t.status END,
    'roundStatus',CASE WHEN d.table_id IS NULL THEN 'not_opened' WHEN h.id IS NULL THEN 'awaiting_deal'
      WHEN h.status='complete' THEN 'complete' WHEN h.status='voided' THEN 'voided' ELSE 'playing' END,
    'seats',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',s.id,'seatNo',s.seat_no,'stack',s.stack::text,
        'canMove',s.stack>0 AND s.status='sitting',
        'placementRevision',(SELECT count(*)::text FROM online_satellite_private.round_seat_moves move
          WHERE move.pilot_id=a.id AND move.seat_id=s.id)) ORDER BY s.seat_no)
      FROM public.online_poker_seats s WHERE s.table_id=t.id
    ),'[]'::jsonb)
  ) ORDER BY (t.id=anchor.table_id) DESC,t.id))
  FROM checkpoint a
  JOIN online_satellite_private.table_clocks anchor ON anchor.pilot_id=a.id
  JOIN online_satellite_private.round_tables m ON m.pilot_id=a.id
  JOIN public.online_poker_tables t ON t.id=m.table_id AND t.club_id=a.club_id AND t.is_satellite
  LEFT JOIN online_satellite_private.round_deals d ON d.pilot_id=a.id AND d.table_id=t.id AND d.round_no=a.round_no
  LEFT JOIN public.online_poker_hands h ON h.id=d.hand_id AND h.table_id=t.id
  GROUP BY a.round_no;
$$;
REVOKE ALL ON FUNCTION public.get_online_satellite_round_operations_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_online_satellite_round_operations_v1(uuid) TO authenticated;
COMMIT;
