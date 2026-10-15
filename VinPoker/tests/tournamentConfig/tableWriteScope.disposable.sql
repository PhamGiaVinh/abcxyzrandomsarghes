\set ON_ERROR_STOP on
-- Reproduce the live-shaped defect, then test actual forward migration86.
-- Empty disposable PostgreSQL17 only; no live writes. Everything rolls back.
BEGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA floor_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('fixture.actor',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
SELECT set_config('fixture.actor','11111111-1111-1111-1111-111111111111',true);
CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs(id));
CREATE TABLE public.game_tables(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs(id));
CREATE TABLE public.table_sessions(id uuid PRIMARY KEY,game_table_id uuid,tournament_id uuid);
CREATE TABLE public.club_dealer_controls(user_id uuid,club_id uuid);
CREATE TYPE public.app_role AS ENUM('super_admin');
CREATE FUNCTION public.has_role(actor uuid,requested public.app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT actor='44444444-4444-4444-4444-444444444444'::uuid $$;
CREATE FUNCTION public.is_club_dealer_control(actor uuid,club uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.club_dealer_controls c WHERE c.user_id=actor AND c.club_id=club)
    OR EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club AND c.owner_id=actor)
$$;
CREATE TABLE public.tournament_tables(
  id uuid PRIMARY KEY,tournament_id uuid REFERENCES public.tournaments(id),
  table_name text NOT NULL DEFAULT '',status text NOT NULL CHECK(status IN ('active','broken','closed')),
  table_id uuid,game_table_id uuid,table_session_id uuid,
  UNIQUE(tournament_id,table_name)
);
INSERT INTO public.clubs VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222');
INSERT INTO public.tournaments VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.game_tables VALUES
  ('aaaaaaaa-0000-0000-0000-000000000010','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-0000-0000-000000000011','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-0000-0000-0000-000000000010','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.table_sessions VALUES
  ('aaaaaaaa-0000-0000-0000-000000000020','aaaaaaaa-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000020','bbbbbbbb-0000-0000-0000-000000000010','bbbbbbbb-0000-0000-0000-000000000001');
INSERT INTO public.club_dealer_controls VALUES
  ('33333333-3333-3333-3333-333333333333','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
ALTER TABLE public.tournament_tables ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tournament_tables TO authenticated,anon,service_role;
-- Exact command/role/predicate shape captured from live pg_policies.
CREATE POLICY tournament_tables_select ON public.tournament_tables
  FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_tables_public_anon_read ON public.tournament_tables
  FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY tournament_tables_insert ON public.tournament_tables
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY tournament_tables_update ON public.tournament_tables
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY tournament_tables_delete ON public.tournament_tables
  FOR DELETE TO authenticated USING (true);
SET LOCAL ROLE authenticated;
INSERT INTO public.tournament_tables(id,tournament_id,table_name,status) VALUES
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
-- Seed a foreign-club row as the fixture owner, not through repaired policies.
INSERT INTO public.tournament_tables(id,tournament_id,table_name,status) VALUES
  ('cccccccc-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000001','Foreign fixture','active');
\ir ../../supabase/migrations/20270128000086_tournament_table_write_tenant_v1.sql
SET LOCAL ROLE authenticated;
INSERT INTO public.tournament_tables(id,tournament_id,table_name,status,table_id,game_table_id,table_session_id) VALUES
  ('cccccccc-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Own fixture','active',
   'aaaaaaaa-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-000000000010','aaaaaaaa-0000-0000-0000-000000000020');
DO $$ DECLARE affected integer; BEGIN
  UPDATE public.tournament_tables SET table_name='Own edited'
    WHERE id='cccccccc-0000-0000-0000-000000000004';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Owner own-club update failed'; END IF;
  UPDATE public.tournament_tables SET table_name='UNAUTHORIZED'
    WHERE id='cccccccc-0000-0000-0000-000000000005';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Cross-club update allowed'; END IF;
  DELETE FROM public.tournament_tables WHERE id='cccccccc-0000-0000-0000-000000000005';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Cross-club delete allowed'; END IF;
  BEGIN
    INSERT INTO public.tournament_tables(id,tournament_id,table_name,status) VALUES
      ('cccccccc-0000-0000-0000-000000000006','bbbbbbbb-0000-0000-0000-000000000001','NO','active');
    RAISE EXCEPTION 'Cross-club insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.tournament_tables SET tournament_id='bbbbbbbb-0000-0000-0000-000000000001'
      WHERE id='cccccccc-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'Cross-club reparent allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.tournament_tables SET table_id='bbbbbbbb-0000-0000-0000-000000000010'
      WHERE id='cccccccc-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'Foreign physical table allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.tournament_tables SET table_session_id='bbbbbbbb-0000-0000-0000-000000000020'
      WHERE id='cccccccc-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'Foreign/mismatched session allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.tournament_tables SET game_table_id='aaaaaaaa-0000-0000-0000-000000000011'
      WHERE id='cccccccc-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'Contradictory same-club physical aliases allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('fixture.actor','33333333-3333-3333-3333-333333333333',true);
  UPDATE public.tournament_tables SET table_name='Dealer control edited'
    WHERE id='cccccccc-0000-0000-0000-000000000004';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Assigned Dealer Control update failed'; END IF;
  INSERT INTO public.tournament_tables(id,tournament_id,table_name,status,table_id) VALUES
    ('cccccccc-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','Temporary legacy link','active',
     'aaaaaaaa-0000-0000-0000-000000000010');
  DELETE FROM public.tournament_tables WHERE id='cccccccc-0000-0000-0000-000000000007';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Assigned own-club delete failed'; END IF;
  PERFORM set_config('fixture.actor','55555555-5555-5555-5555-555555555555',true);
  DELETE FROM public.tournament_tables WHERE id='cccccccc-0000-0000-0000-000000000004';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Unassigned actor delete allowed'; END IF;
  PERFORM set_config('fixture.actor','44444444-4444-4444-4444-444444444444',true);
  UPDATE public.tournament_tables SET table_name='Admin edited'
    WHERE id='cccccccc-0000-0000-0000-000000000005';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Actual super-admin update failed'; END IF;
  PERFORM set_config('fixture.actor','',true);
  DELETE FROM public.tournament_tables;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Missing actor delete allowed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tournament_tables)<>2 THEN
    RAISE EXCEPTION 'Public read changed';
  END IF;
  BEGIN
    INSERT INTO public.tournament_tables(id,tournament_id,table_name,status) VALUES
      ('cccccccc-0000-0000-0000-000000000006','bbbbbbbb-0000-0000-0000-000000000001','NO','active');
    RAISE EXCEPTION 'Anonymous insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE affected integer; BEGIN
  UPDATE public.tournament_tables SET table_name='Trusted service edited'
    WHERE id='cccccccc-0000-0000-0000-000000000005';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Existing trusted service write blocked'; END IF;
END $$;
RESET ROLE;
\echo TOURNAMENT_TABLE86_ACTOR_TENANT_PHYSICAL_SESSION_AND_PUBLIC_READ_PASS
ROLLBACK;
