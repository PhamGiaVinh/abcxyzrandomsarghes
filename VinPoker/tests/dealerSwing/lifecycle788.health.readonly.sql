\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 -- Inspect actual state, not a fabricated close/reopen success response.
 ASSERT NOT EXISTS(SELECT 1 FROM public.table_sessions s JOIN public.tournaments t ON t.id=s.tournament_id
  WHERE s.closed_at IS NULL AND t.status IN('completed','cancelled')),
  'terminal tournament still has an open physical session';
 ASSERT NOT EXISTS(SELECT 1 FROM public.dealer_assignments a JOIN public.table_sessions s ON s.id=a.table_session_id
  WHERE s.closed_at IS NOT NULL AND a.released_at IS NULL AND a.status IN('active','assigned','in_transition')),
  'closed session still holds a live dealer assignment';
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE rows jsonb;row jsonb; BEGIN
 rows:=public.get_dealer_swing_health(ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','d4427834-5f5f-48ef-bde5-e2dc388ed00b']::uuid[]);
 ASSERT jsonb_array_length(rows)=1,'health exposed foreign club or lost own club';
 row:=rows->0;
 ASSERT row->>'club_id'='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 ASSERT jsonb_typeof(row->'lock'->'held')='boolean';
 ASSERT jsonb_typeof(row->'overdue_now')='number' AND (row->>'overdue_now')::bigint>=0;
 ASSERT (row->'pre_announce'->>'pending')::bigint>=0 AND (row->'pre_announce'->>'processing')::bigint>=0;
 ASSERT public.get_dealer_swing_health(ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b']::uuid[])='[]'::jsonb,
  'foreign-only scope was not filtered';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
SET LOCAL request.jwt.claims='{"sub":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE rows jsonb; BEGIN
 rows:=public.get_dealer_swing_health(ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b']::uuid[]);
 ASSERT jsonb_array_length(rows)=1 AND rows->0->>'club_id'='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 ASSERT (rows->0->>'overdue_now')::bigint=0,'completed Single244 still reports an overdue live assignment';
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{}';
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.get_dealer_swing_health(ARRAY['d4427834-5f5f-48ef-bde5-e2dc388ed00b']::uuid[]);
  RAISE EXCEPTION 'anonymous health access unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'LIFECYCLE788_NATIVE_TERMINAL_SESSION_ASSIGNMENT_OWNER_FOREIGN_ANON_HEALTH_READONLY_PASS';
