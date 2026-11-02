-- Real installed RPC denial/ACL boundaries, NOT a positive redemption fixture.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ DECLARE fn regprocedure; missing uuid:='e4820000-0000-4000-8000-000000000001'; BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c'
  AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM public.satellite_tickets WHERE redemption_code=missing);
 ASSERT NOT EXISTS(SELECT 1 FROM public.satellite_redemption_requests WHERE request_id=missing);
 FOREACH fn IN ARRAY ARRAY['public.satellite_verify_ticket_v1(uuid)'::regprocedure,
  'public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid)'::regprocedure,
  'public.satellite_get_redemption_receipt_v1(uuid)'::regprocedure] LOOP
  ASSERT has_function_privilege('authenticated',fn,'EXECUTE');
  ASSERT NOT has_function_privilege('anon',fn,'EXECUTE');
  ASSERT NOT has_function_privilege('service_role',fn,'EXECUTE');
  ASSERT (SELECT prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid=fn);
 END LOOP;
END $$;
SELECT set_config('test.satellite482.before',md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.satellite_tickets x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM public.satellite_redemption_requests x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.satellite_ticket_value_transfers x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x))::text),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE actor text; probe record; message text; BEGIN
 FOREACH actor IN ARRAY ARRAY['','675fe35e-60a8-4452-bb90-e79486d54da6'] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor,true);
  ASSERT auth.uid() IS NOT DISTINCT FROM nullif(actor,'')::uuid;
  FOR probe IN SELECT * FROM (VALUES
   ('SELECT public.satellite_verify_ticket_v1(''e4820000-0000-4000-8000-000000000001'')',
    'satellite_verify_request_invalid','satellite_ticket_not_current'),
   ('SELECT public.satellite_redeem_ticket_v1(''e4820000-0000-4000-8000-000000000001'',''e4820000-0000-4000-8000-000000000001'',''533feda3-28c5-4194-bdf3-53a07c41305b'',NULL)',
    'satellite_redeem_request_invalid','satellite_ticket_not_current'),
   ('SELECT public.satellite_get_redemption_receipt_v1(''e4820000-0000-4000-8000-000000000001'')',
    'satellite_receipt_request_invalid','satellite_receipt_not_found')) AS p(statement,no_actor,not_found)
  LOOP
   BEGIN
    EXECUTE probe.statement;
    RAISE EXCEPTION 'Unexpected Satellite success';
   EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
    ASSERT message=CASE WHEN actor='' THEN probe.no_actor ELSE probe.not_found END,message;
   END;
  END LOOP;
 END LOOP;
 RAISE NOTICE 'SATELLITE482_AUTHENTICATED_NO_ACTOR_AND_MISSING_TICKET_RECEIPT_DENIALS_PASS';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE statement text; BEGIN
 FOREACH statement IN ARRAY ARRAY[
  'SELECT public.satellite_verify_ticket_v1(NULL)',
  'SELECT public.satellite_redeem_ticket_v1(NULL,NULL,NULL,NULL)',
  'SELECT public.satellite_get_redemption_receipt_v1(NULL)'] LOOP
  BEGIN EXECUTE statement; RAISE EXCEPTION 'Anonymous Satellite RPC unexpectedly callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 RAISE NOTICE 'SATELLITE482_ANON_EXECUTE_DENIED_PASS';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT current_setting('test.satellite482.before')=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.satellite_tickets x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY request_id) FROM public.satellite_redemption_requests x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.satellite_ticket_value_transfers x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_registrations x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x))::text);
 RAISE NOTICE 'SATELLITE482_TICKETS_RECEIPTS_TRANSFERS_ENTRIES_SEATS_CASH_UNCHANGED_PASS';
END $$;
ROLLBACK;
