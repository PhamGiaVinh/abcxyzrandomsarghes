-- Inside an explicit transaction; remove only the previously absent new objects.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_players239()'::regprocedure)='2339b79e35f0b84d12c0cc30fde22265';
 ASSERT (SELECT tgfoid='floor_private.guard_tournament_players239()'::regprocedure AND tgenabled='O' FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_players_integrity239');
END $$;
DROP TRIGGER trg_tournament_players_integrity239 ON public.tournaments;
DROP FUNCTION floor_private.guard_tournament_players239();
