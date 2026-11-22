-- Extends the disposable Cashier reversal fixture with Tracker V3 lease fields.
-- No fixture or schema change in a linked environment.
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE public.table_sessions (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  game_table_id uuid NOT NULL REFERENCES public.game_tables(id),
  control_mode text NOT NULL,
  control_epoch bigint NOT NULL,
  closed_at timestamptz
);
ALTER TABLE public.tournament_tables
  ADD COLUMN game_table_id uuid REFERENCES public.game_tables(id),
  ADD COLUMN table_session_id uuid REFERENCES public.table_sessions(id),
  ADD COLUMN floor_control_mode text;
ALTER TABLE public.tournament_seats
  ADD COLUMN tournament_table_id uuid REFERENCES public.tournament_tables(id),
  ADD COLUMN table_session_id uuid REFERENCES public.table_sessions(id),
  ADD COLUMN avatar_url text;
ALTER TABLE public.tournament_hands
  ADD COLUMN tournament_table_id uuid REFERENCES public.tournament_tables(id),
  ADD COLUMN table_session_id uuid REFERENCES public.table_sessions(id),
  ADD COLUMN status text,
  ADD COLUMN is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN community_cards jsonb,
  ADD COLUMN pot_size integer,
  ADD COLUMN created_by uuid,
  ADD COLUMN locked_by_user_id uuid,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN button_seat integer;
ALTER TABLE public.hand_players
  ALTER COLUMN ending_stack DROP NOT NULL,
  ADD COLUMN hole_cards jsonb,
  ADD COLUMN player_name text,
  ADD COLUMN avatar_url text;

-- The caller for this scenario is the fixture owner.
CREATE TABLE public.club_trackers (club_id uuid NOT NULL, user_id uuid NOT NULL);
CREATE FUNCTION public.is_club_tracker(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.club_trackers ct
    WHERE ct.user_id = _user_id AND ct.club_id = _club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = _club_id AND c.owner_id = _user_id
  ) OR public.has_role(_user_id, 'super_admin')
$function$;

DO $fixture$
DECLARE
  lease_id uuid := 'd9000000-0000-4000-8000-000000000023';
  assignment_id uuid;
  physical_table_id uuid;
  target_id uuid;
  club_id uuid;
  fixture_seat_id uuid;
BEGIN
  SELECT tt.id, tt.table_id, t.target_tournament_id, t.club_id, s.id
    INTO STRICT assignment_id, physical_table_id, target_id, club_id, fixture_seat_id
    FROM public.satellite_tickets t
    JOIN public.tournament_entries e ON e.registration_id = t.registration_id
    JOIN public.tournament_seats s ON s.entry_id = e.id AND s.is_active
    JOIN public.tournament_tables tt ON tt.tournament_id = t.target_tournament_id
      AND (s.table_id = tt.id OR s.table_id = tt.table_id)
    WHERE t.source_tournament_id = 'd3000000-0000-4000-8000-000000000011'
      AND t.serial_no = 1 AND t.status = 'redeemed';

  INSERT INTO public.table_sessions(id, club_id, tournament_id, game_table_id, control_mode, control_epoch)
    VALUES (lease_id, club_id, target_id, physical_table_id, 'tracker', 1);
  UPDATE public.tournament_tables
    SET table_session_id = lease_id, game_table_id = physical_table_id, floor_control_mode = 'tracker'
    WHERE id = assignment_id;
  UPDATE public.tournament_seats
    SET table_session_id = lease_id, tournament_table_id = assignment_id
    WHERE id = fixture_seat_id;
END;
$fixture$;
COMMIT;

\ir ../migrations/20270115000010_tracker_v3_hand_start_context.sql
