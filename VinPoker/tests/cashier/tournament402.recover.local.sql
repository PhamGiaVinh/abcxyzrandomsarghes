-- Recovery removes ONLY the two previously absent objects. Caller wraps in tx.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_guarantee237()'::regprocedure)='01e390e92a028871a8fc762525a78470';
 ASSERT (SELECT tgfoid='floor_private.guard_tournament_guarantee237()'::regprocedure AND tgenabled='O' FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_guarantee_integrity237');
END $$;
DROP TRIGGER trg_tournament_guarantee_integrity237 ON public.tournaments;
DROP FUNCTION floor_private.guard_tournament_guarantee237();
