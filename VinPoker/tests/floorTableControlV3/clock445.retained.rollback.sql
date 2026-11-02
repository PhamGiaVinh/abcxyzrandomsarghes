BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c' AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
END $$;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
DO $test$ DECLARE tour uuid:='46cab483-91e7-4220-aacf-e17bdf05269c';c jsonb;r jsonb;after_clock jsonb;delta integer;expected integer;
BEGIN
 c:=public.get_tournament_clock(tour);
 ASSERT c->>'status'='live' AND c->'is_running'='false'::jsonb AND length(c->>'control_revision')=32;
 delta:=CASE WHEN (c->>'remaining_seconds')::integer>0 THEN -1 ELSE 1 END;
 r:=public.floor_control_tournament_clock(tour,'adjust_time',delta,c->>'control_revision');
 ASSERT r->'ok'='true'::jsonb AND r->'changed'='true'::jsonb;
 ASSERT r->>'control_revision'<>c->>'control_revision';
 after_clock:=public.get_tournament_clock(tour);
 ASSERT (after_clock->>'remaining_seconds')::int=(c->>'remaining_seconds')::int+delta;
 -- A lost reply or another controller repeats the old intent, not a new CAS snapshot.
 r:=public.floor_control_tournament_clock(tour,'adjust_time',delta,c->>'control_revision');
 ASSERT r->>'error'='stale_clock_state';
 ASSERT public.get_tournament_clock(tour)=after_clock;
 r:=public.floor_control_tournament_clock(tour,'next_level',NULL,c->>'control_revision');
 ASSERT r->>'error'='stale_clock_state';
 ASSERT public.get_tournament_clock(tour)=after_clock;
 FOREACH delta IN ARRAY ARRAY[-60,60,-1,1,0] LOOP
  c:=public.get_tournament_clock(tour);
  expected:=greatest(0,least((c#>>'{current_level,duration_minutes}')::int*60,(c->>'remaining_seconds')::int+delta));
  r:=public.floor_control_tournament_clock(tour,'adjust_time',delta,c->>'control_revision');
  ASSERT r->'ok'='true'::jsonb;
  after_clock:=public.get_tournament_clock(tour);
  ASSERT (after_clock->>'remaining_seconds')::int=expected;
  ASSERT r->>'control_revision'=after_clock->>'control_revision';
 END LOOP;
 r:=public.floor_control_tournament_clock('4cd3af4d-7e1d-4042-855f-04fb6777e580','resume',NULL,after_clock->>'control_revision');
 ASSERT r->>'error'='tournament_not_open';
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
 r:=public.floor_control_tournament_clock(tour,'adjust_time',1,after_clock->>'control_revision');
 ASSERT r->>'error'='actor_not_allowed';
 RAISE NOTICE 'CLOCK445_NATIVE_CURRENT_CAS_OLD_RETRY_STALE_OTHER_ACTION_STALE_TERMINAL_OUTSIDER_PASS';
END $test$;
RESET ROLE;
ROLLBACK;
