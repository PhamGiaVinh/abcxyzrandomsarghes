\set ON_ERROR_STOP on
-- Real restored schema/roles/policies. No authorization helper replacements.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'vinpoker_ops_tenant86_%'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'owned_tenant86_required'; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
INSERT INTO auth.users(id) VALUES
 ('f2860000-0000-4000-8000-000000000001'),('f2860000-0000-4000-8000-000000000002'),
 ('f2860000-0000-4000-8000-000000000003');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f2860000-0000-4000-8000-000000000011','f2860000-0000-4000-8000-000000000001','Tenant A TEST','TEST'),
 ('f2860000-0000-4000-8000-000000000012','f2860000-0000-4000-8000-000000000002','Tenant B TEST','TEST');
INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES
 ('f2860000-0000-4000-8000-000000000011','f2860000-0000-4000-8000-000000000003');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES
 ('f2860000-0000-4000-8000-000000000021','f2860000-0000-4000-8000-000000000011','Tenant A TEST','live','playing'),
 ('f2860000-0000-4000-8000-000000000022','f2860000-0000-4000-8000-000000000012','Tenant B TEST','live','playing');
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f2860000-0000-4000-8000-000000000041','f2860000-0000-4000-8000-000000000011','Tenant A TEST',1,'tournament','inactive','available'),
 ('f2860000-0000-4000-8000-000000000042','f2860000-0000-4000-8000-000000000012','Tenant B TEST',2,'tournament','inactive','available'),
 ('f2860000-0000-4000-8000-000000000043','f2860000-0000-4000-8000-000000000011','Other A TEST',3,'tournament','inactive','available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode,control_epoch,revision,opened_by) VALUES
 ('f2860000-0000-4000-8000-000000000051','f2860000-0000-4000-8000-000000000011','f2860000-0000-4000-8000-000000000041','tournament','f2860000-0000-4000-8000-000000000021','manual',1,1,'f2860000-0000-4000-8000-000000000001'),
 ('f2860000-0000-4000-8000-000000000052','f2860000-0000-4000-8000-000000000012','f2860000-0000-4000-8000-000000000042','tournament','f2860000-0000-4000-8000-000000000022','manual',1,1,'f2860000-0000-4000-8000-000000000002');
INSERT INTO public.tournament_tables(id,tournament_id,table_name,status,table_id,game_table_id,table_session_id) VALUES
 ('f2860000-0000-4000-8000-000000000032','f2860000-0000-4000-8000-000000000022','Foreign TEST','active','f2860000-0000-4000-8000-000000000042','f2860000-0000-4000-8000-000000000042','f2860000-0000-4000-8000-000000000052');
SELECT set_config('request.jwt.claim.sub','f2860000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.tournament_tables(id,tournament_id,table_name,status,table_id,game_table_id,table_session_id) VALUES
 ('f2860000-0000-4000-8000-000000000031','f2860000-0000-4000-8000-000000000021','Own TEST','active','f2860000-0000-4000-8000-000000000041','f2860000-0000-4000-8000-000000000041','f2860000-0000-4000-8000-000000000051');
DO $$ DECLARE affected integer; statement text; BEGIN
 UPDATE public.tournament_tables SET table_name='Owner edited TEST' WHERE id='f2860000-0000-4000-8000-000000000031';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'owner_positive_missing'; END IF;
 UPDATE public.tournament_tables SET table_name='UNAUTHORIZED' WHERE id='f2860000-0000-4000-8000-000000000032';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'cross_club_update_allowed'; END IF;
 DELETE FROM public.tournament_tables WHERE id='f2860000-0000-4000-8000-000000000032';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'cross_club_delete_allowed'; END IF;
 BEGIN
  INSERT INTO public.tournament_tables(tournament_id,table_name,status) VALUES
   ('f2860000-0000-4000-8000-000000000022','UNAUTHORIZED','closed');
  RAISE EXCEPTION 'cross_club_insert_allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 FOREACH statement IN ARRAY ARRAY[
  'UPDATE public.tournament_tables SET tournament_id=''f2860000-0000-4000-8000-000000000022''',
  'UPDATE public.tournament_tables SET table_id=''f2860000-0000-4000-8000-000000000042''',
  'UPDATE public.tournament_tables SET game_table_id=''f2860000-0000-4000-8000-000000000043''',
  'UPDATE public.tournament_tables SET table_session_id=''f2860000-0000-4000-8000-000000000052'''] LOOP
  BEGIN
   EXECUTE statement||' WHERE id=''f2860000-0000-4000-8000-000000000031''';
   RAISE EXCEPTION 'invalid_tuple_update_allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f2860000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
 UPDATE public.tournament_tables SET table_name='Dealer Control edited TEST' WHERE id='f2860000-0000-4000-8000-000000000031';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'dealer_control_positive_missing'; END IF;
 DELETE FROM public.tournament_tables WHERE id='f2860000-0000-4000-8000-000000000031';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'own_delete_positive_missing'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.tournament_tables WHERE id='f2860000-0000-4000-8000-000000000032') THEN
  RAISE EXCEPTION 'public_read_changed'; END IF;
 BEGIN INSERT INTO public.tournament_tables(tournament_id,table_name,status) VALUES
  ('f2860000-0000-4000-8000-000000000022','ANON','closed');
  RAISE EXCEPTION 'anonymous_write_allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo ACTUAL_SCHEMA_TENANT86_DIRECT_WRITE_BOUNDARIES_PASS
ROLLBACK;
