\set ON_ERROR_STOP on
-- Local PG17 supplement to trackerUnifiedOps/disposableDb.baseline.sql and
-- trackerVoice/disposableDb.dependencies.sql. No production apply entry point.
DO $$ BEGIN
  ASSERT current_database() IN ('tracker_bba349', 'tracker_bba349_current');
  ASSERT inet_server_port() = 55519 AND host(inet_server_addr()) = '127.0.0.1';
  ASSERT position('tracker-bba349-pg17-' IN current_setting('data_directory')) > 0;
END $$;
CREATE SCHEMA IF NOT EXISTS floor_private;
CREATE TABLE IF NOT EXISTS public.table_sessions (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  control_mode text NOT NULL,
  closed_at timestamptz
);
ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS table_session_id uuid;

-- The pinned pre-Voice authority fixture uses SECURITY INVOKER record_action.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT, UPDATE ON public.tournament_hands TO authenticated;
GRANT SELECT ON public.tournaments, public.hand_players, public.hand_actions TO authenticated;
GRANT INSERT ON public.hand_actions TO authenticated;
