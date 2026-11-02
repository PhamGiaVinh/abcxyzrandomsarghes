\set ON_ERROR_STOP on
-- LOCAL recovery only; not executed by regression. No data/ledger rollback.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR inet_server_addr()<>'127.0.0.1'::inet
 OR inet_server_port()<>55441 OR current_setting('data_directory')<>'/tmp/vinpoker-sol-local-20261016-0e79a729/data'
 OR md5(replace(pg_get_functiondef('public.initialize_club_tables()'::regprocedure),chr(13),''))<>'14c642ada91c8ac9a935ab712aa8e35a'
 THEN RAISE EXCEPTION 'pool221_local_recovery_definition_mismatch'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.initialize_club_tables()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 FOR i IN 1..100 LOOP
  INSERT INTO public.game_tables(club_id,table_name,table_type,status,game_type)
  VALUES(NEW.id,'Bàn '||i,'tournament','inactive','NLH')
  ON CONFLICT(club_id,table_name) WHERE shift_id IS NULL DO NOTHING;
 END LOOP;
 RETURN NEW;
END;
$$;
COMMIT;
