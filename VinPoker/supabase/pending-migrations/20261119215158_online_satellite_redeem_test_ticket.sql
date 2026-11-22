-- Pending: the pilot writes TEST entries only. It never creates a Cashier
-- registration, funded tournament entry, or financial ledger row.
BEGIN;

CREATE TABLE IF NOT EXISTS online_satellite_private.test_target_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES online_satellite_private.test_destinations(tournament_id),
  player_user_id uuid NOT NULL REFERENCES auth.users(id),
  ticket_id uuid NOT NULL UNIQUE REFERENCES online_satellite_private.test_tickets(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(destination_id,player_user_id)
);
ALTER TABLE online_satellite_private.test_target_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON online_satellite_private.test_target_entries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.redeem_online_satellite_test_ticket_v1(p_ticket_id uuid, p_destination_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid;
  target_club uuid;
  expires timestamptz;
  entry_id uuid;
BEGIN
  SELECT b.destination_id,p.club_id,b.expires_at INTO target,target_club,expires
  FROM online_satellite_private.test_tickets ticket
  JOIN online_satellite_private.test_ticket_batches b ON b.pilot_id=ticket.pilot_id
  JOIN online_satellite_private.pilots p ON p.id=b.pilot_id
  JOIN online_satellite_private.entries e ON e.id=ticket.entry_id AND e.pilot_id=b.pilot_id
  WHERE ticket.id=p_ticket_id AND e.player_user_id=actor
  FOR UPDATE OF ticket;
  IF actor IS NULL OR NOT FOUND OR p_destination_id IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'SATELLITE_TEST_TICKET_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.tournaments t
    JOIN online_satellite_private.test_destinations d ON d.tournament_id=t.id AND d.club_id=t.club_id
    WHERE t.id=target AND t.club_id=target_club FOR SHARE OF t,d;
  IF NOT FOUND THEN RAISE EXCEPTION 'SATELLITE_TEST_TICKET_NOT_AVAILABLE' USING ERRCODE='42501'; END IF;

  SELECT id INTO entry_id FROM online_satellite_private.test_target_entries WHERE ticket_id=p_ticket_id;
  IF FOUND THEN RETURN jsonb_build_object('outcome','ok','idempotent',true,'testEntryId',entry_id); END IF;
  IF expires <= clock_timestamp() THEN RETURN jsonb_build_object('outcome','expired'); END IF;

  INSERT INTO online_satellite_private.test_target_entries(destination_id,player_user_id,ticket_id)
    VALUES (target,actor,p_ticket_id)
    ON CONFLICT (destination_id,player_user_id) DO NOTHING
    RETURNING id INTO entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','already_registered'); END IF;
  RETURN jsonb_build_object('outcome','ok','idempotent',false,'testEntryId',entry_id);
END;
$$;

CREATE FUNCTION public.get_my_online_satellite_test_ticket_v1(p_pilot_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('ticketId',ticket.id,'destinationId',b.destination_id,
    'destinationName',t.name,'expiresAt',b.expires_at,'testEntryId',redeemed.id)
  FROM online_satellite_private.test_tickets ticket
  JOIN online_satellite_private.test_ticket_batches b ON b.pilot_id=ticket.pilot_id
  JOIN online_satellite_private.pilots p ON p.id=b.pilot_id
  JOIN online_satellite_private.entries e ON e.id=ticket.entry_id AND e.pilot_id=b.pilot_id
  JOIN online_satellite_private.test_destinations d ON d.tournament_id=b.destination_id AND d.club_id=p.club_id
  JOIN public.tournaments t ON t.id=d.tournament_id AND t.club_id=d.club_id
  LEFT JOIN online_satellite_private.test_target_entries redeemed ON redeemed.ticket_id=ticket.id
  WHERE ticket.pilot_id=p_pilot_id AND e.player_user_id=(SELECT auth.uid());
$$;

REVOKE ALL ON FUNCTION public.redeem_online_satellite_test_ticket_v1(uuid,uuid),
  public.get_my_online_satellite_test_ticket_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.redeem_online_satellite_test_ticket_v1(uuid,uuid),
  public.get_my_online_satellite_test_ticket_v1(uuid) TO authenticated;

COMMIT;
