\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_cash115_qualified_c' OR host(inet_server_addr())<>'127.0.0.1' OR inet_server_port()<>55441 THEN RAISE EXCEPTION 'wrong_recovery366_database';END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_public_tournament_registration_summary_v1(uuid)'::regprocedure)<>'62adafff953b61d42a6e4ebed8072150' THEN RAISE EXCEPTION 'changed_function366_do_not_drop';END IF;
END $$;
DROP FUNCTION public.get_public_tournament_registration_summary_v1(uuid);
COMMIT;
