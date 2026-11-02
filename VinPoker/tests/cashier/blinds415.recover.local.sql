-- Run inside an explicit transaction, LOCAL only; never drop dependent objects.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='floor_private.guard_tournament_blinds240()'::regprocedure)='f6d7d369d7cf04e154750bd676370333';
 ASSERT (SELECT tgfoid='floor_private.guard_tournament_blinds240()'::regprocedure AND tgenabled='O' FROM pg_trigger WHERE tgrelid='public.tournament_levels'::regclass AND tgname='trg_tournament_blind_integrity240');
END $$;
DROP TRIGGER trg_tournament_blind_integrity240 ON public.tournament_levels;
DROP FUNCTION floor_private.guard_tournament_blinds240();
