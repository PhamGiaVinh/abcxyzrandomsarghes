-- Disposable-only columns and minimal policy helpers required by the exact
-- tracker settlement/history migrations. Uses the publicSpectatorV2 baseline.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pgcrypto SET SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE SCHEMA IF NOT EXISTS floor_private;

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live';
ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS side_pots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tracker_level_id uuid,
  ADD COLUMN IF NOT EXISTS tracker_is_break boolean,
  ADD COLUMN IF NOT EXISTS tracker_blind_evidence jsonb;
ALTER TABLE public.tournament_levels ADD COLUMN IF NOT EXISTS is_break boolean NOT NULL DEFAULT false;

-- publicSpectatorV2's small history fixture declares a placeholder outcome
-- table. Replace that empty table so migration 00002 creates the canonical one.
DROP TABLE public.tournament_settlement_outcomes;

CREATE OR REPLACE FUNCTION public.is_club_admin(p_user_id uuid, p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
