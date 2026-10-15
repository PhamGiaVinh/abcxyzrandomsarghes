\set ON_ERROR_STOP on
-- DIAGNOSTIC ONLY: passing reproduces the UNFIXED live-shaped write policy.
-- Empty disposable PostgreSQL17 only; no live writes. Everything rolls back.
BEGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT '11111111-1111-1111-1111-111111111111'::uuid
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs(id));
CREATE TABLE public.tournament_tables(
  id uuid PRIMARY KEY,tournament_id uuid REFERENCES public.tournaments(id),
  table_name text NOT NULL DEFAULT '',status text NOT NULL CHECK(status IN ('active','broken','closed')),
  UNIQUE(tournament_id,table_name)
);
INSERT INTO public.clubs VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222');
INSERT INTO public.tournaments VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
ALTER TABLE public.tournament_tables ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tournament_tables TO authenticated;
-- Exact command/role/predicate shape captured from live pg_policies.
CREATE POLICY tournament_tables_select ON public.tournament_tables
  FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_tables_insert ON public.tournament_tables
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY tournament_tables_update ON public.tournament_tables
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY tournament_tables_delete ON public.tournament_tables
  FOR DELETE TO authenticated USING (true);
SET LOCAL ROLE authenticated;
INSERT INTO public.tournament_tables VALUES
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','TEST foreign club','active');
UPDATE public.tournament_tables SET status='closed'
  WHERE id='cccccccc-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT status FROM public.tournament_tables
      WHERE id='cccccccc-0000-0000-0000-000000000001') IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'Expected cross-club INSERT/UPDATE reproduction was absent';
  END IF;
END $$;
DELETE FROM public.tournament_tables WHERE id='cccccccc-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.tournament_tables) THEN
    RAISE EXCEPTION 'Expected cross-club DELETE reproduction was absent';
  END IF;
  -- The real legacy hook omits table_name for every selected physical table.
  -- Live default '' plus UNIQUE(tournament_id,table_name) rejects the batch.
  BEGIN
    INSERT INTO public.tournament_tables(id,tournament_id,status) VALUES
      ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','active'),
      ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','active');
    RAISE EXCEPTION 'Expected omitted table_name multi-link conflict was absent';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.tournament_tables) THEN
    RAISE EXCEPTION 'Failed multi-link statement unexpectedly committed a partial link';
  END IF;
END $$;
RESET ROLE;
\echo TOURNAMENT_TABLE_WRITE_TENANT_BOUNDARY_UNFIXED_REPRODUCED
\echo TOURNAMENT_CONFIG_MULTI_LINK_EMPTY_NAME_CONFLICT_REPRODUCED
ROLLBACK;
