-- Recovery for the new local read API only; never changes the legacy function or money.
BEGIN;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT md5(pg_get_functiondef('public.get_club_finance_summary_v2(date,date,uuid)'::regprocedure))='9097d813d8f0203d694691be8c1bafff';
END $$;
REVOKE EXECUTE ON FUNCTION public.get_club_finance_summary_v2(date,date,uuid) FROM authenticated;
COMMIT;
