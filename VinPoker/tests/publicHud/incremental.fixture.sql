-- Disposable DATABASE only. No production credentials, copied users or fixtures.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
DO $bootstrap$ BEGIN
 IF to_regprocedure('auth.role()') IS NULL THEN
  EXECUTE $definition$ CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$ $definition$;
 END IF;
END $bootstrap$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA spectator_projection_v2;
CREATE TABLE spectator_projection_v2.publications(tournament_id uuid,component text,payload jsonb,
  PRIMARY KEY(tournament_id,component));
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,deleted_at timestamptz,status text NOT NULL DEFAULT 'live');
CREATE TABLE public.tournament_hands(id uuid PRIMARY KEY,tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  tournament_table_id uuid,table_session_id uuid,
  hand_number integer NOT NULL DEFAULT 1,hand_time timestamptz,button_seat integer DEFAULT 1,community_cards jsonb DEFAULT '[]',
  status text NOT NULL DEFAULT 'completed',is_voided boolean DEFAULT false,source_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.hand_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hand_id uuid REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  tournament_id uuid,player_id uuid,entry_number integer DEFAULT 1,seat_number integer,starting_stack bigint,
  player_name text,avatar_url text,UNIQUE(hand_id,player_id,entry_number));
CREATE TABLE public.hand_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hand_id uuid REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  player_id uuid,street text,action_type text,action_amount bigint,action_order integer);
CREATE INDEX fixture_actions_by_hand ON public.hand_actions(hand_id,action_order);
CREATE TABLE public.tournament_settlement_outcomes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hand_id uuid REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  source_revision bigint,settlement_revision bigint,status text,public_outcome jsonb);
CREATE INDEX fixture_outcomes_latest ON public.tournament_settlement_outcomes(hand_id,settlement_revision DESC);
CREATE TABLE public.player_results(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),player_id uuid,verified_by_admin boolean DEFAULT false,
  prize bigint NOT NULL DEFAULT 0,tournament_name text,event_date date,position integer,total_entries integer);
CREATE FUNCTION public.get_public_tournament_settlement(p_hand_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT o.public_outcome FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands h ON h.id=o.hand_id
 JOIN public.tournaments t ON t.id=h.tournament_id WHERE o.hand_id=p_hand_id AND o.status='verified'
 AND o.source_revision=h.source_revision AND t.status IN ('live','final_table','completed','finished')
 ORDER BY settlement_revision DESC LIMIT 1),'{}'::jsonb)
$$;
-- Minimal source-revision contract from the existing source writer. Worker tests
-- exercise source edits with real triggers, not an HTTP model pretending to write.
CREATE FUNCTION public.fixture_bump_hud_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id=OLD.hand_id; END IF;
 IF TG_OP<>'DELETE' AND (TG_OP='INSERT' OR NEW.hand_id IS DISTINCT FROM OLD.hand_id) THEN
 UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id=NEW.hand_id; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER fixture_action_source AFTER INSERT OR UPDATE OR DELETE ON public.hand_actions FOR EACH ROW EXECUTE FUNCTION public.fixture_bump_hud_source();
CREATE TRIGGER fixture_player_source AFTER INSERT OR UPDATE OR DELETE ON public.hand_players FOR EACH ROW EXECUTE FUNCTION public.fixture_bump_hud_source();
