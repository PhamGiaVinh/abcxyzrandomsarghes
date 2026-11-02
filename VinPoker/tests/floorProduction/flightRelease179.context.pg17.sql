-- Read context against the actual linked journey; parent BEGIN/ROLLBACK.
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
 ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT to_regprocedure('public.get_bagged_flight_tables_v1(uuid)') IS NOT NULL,'MISSING_BAGGED_FLOOR_CONTEXT';
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;
BEGIN
 r:=public.get_bagged_flight_tables_v1('fdf91018-09f3-4cdc-b76a-f688eb216cee');
 ASSERT r->>'flightId'='fdf91018-09f3-4cdc-b76a-f688eb216cee' AND r->>'eventId'='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 ASSERT r->>'state'='locked' AND r->>'rosterHash'='9b83697a48dba8fac105ffbf058147a1';
 ASSERT (r->>'dayVersion')::integer=1 AND jsonb_array_length(r->'tables')=1;
 ASSERT r#>>'{tables,0,tournamentTableId}'='8ce69933-b2d0-4dfe-962e-86709c6222ac';
 ASSERT r#>>'{tables,0,tableSessionId}'='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55';
 ASSERT r#>>'{tables,0,state}'='open' AND r#>>'{tables,0,revision}'='10';
 ASSERT r#>>'{tables,0,playerCount}'='8' AND r#>>'{tables,0,baggedTotal}'='160000';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='3add8ca8-34ff-4f52-8b40-a48c192d3aa5';
SET LOCAL request.jwt.claims='{"sub":"3add8ca8-34ff-4f52-8b40-a48c192d3aa5","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.get_bagged_flight_tables_v1('fdf91018-09f3-4cdc-b76a-f688eb216cee');
  RAISE EXCEPTION 'outsider_context_read_accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='bagged_context_scope_denied',SQLERRM; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.get_bagged_flight_tables_v1(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_bagged_flight_tables_v1(uuid)','EXECUTE');
END $$;
SELECT 'RELEASE179_EXACT_CONTEXT_OUTSIDER_ACL_PASS';
