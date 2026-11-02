-- Exact LOCAL recovery: remove only the two new objects, never any source rows.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_fees238()'::regprocedure)='0f6268165f327d6b298d54c327ba97d0';
 ASSERT (SELECT tgfoid='floor_private.guard_tournament_fees238()'::regprocedure AND tgenabled='O' FROM pg_trigger WHERE tgrelid='public.tournaments'::regclass AND tgname='trg_tournament_fee_integrity238');
END $$;
DROP TRIGGER trg_tournament_fee_integrity238 ON public.tournaments;
DROP FUNCTION floor_private.guard_tournament_fees238();
