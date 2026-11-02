\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740' AND status='applied' AND prize_pool_snapshot=300000);
END $$;
SELECT set_config('vinpoker.manual_scenario',:'scenario',true);
CREATE FUNCTION pg_temp.save_manual_intent(rows jsonb,reason text,expected_run uuid,request_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 -- Same intent oracle across the legacy baseline and new fenced public seam.
 -- Never weaken the expected DB cardinality/conflict/stale behavior below.
 IF to_regprocedure('public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid)') IS NOT NULL THEN
  RETURN public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08',rows,reason,expected_run,request_id,auth.uid());
 END IF;
 RETURN public.save_tournament_prizes_v2('6a7fb4a3-8b46-44be-a71a-ca12a052ee08',rows,reason);
END $$;
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';
SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"40b8f243-bf3b-4aaa-962b-db788380207c"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE scenario text:=current_setting('vinpoker.manual_scenario'); before_count integer;
 first_result jsonb; retry_result jsonb; rejected boolean:=false; key uuid:=gen_random_uuid(); BEGIN
 ASSERT scenario IN('replay','conflict','stale');
 SELECT count(*) INTO before_count FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08';
 first_result:=pg_temp.save_manual_intent('[{"position":1,"amount":200000},{"position":2,"amount":100000}]','LOCAL701 rollback intent',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',key);
 ASSERT first_result->>'status'='saved';
 IF scenario='replay' THEN
  retry_result:=pg_temp.save_manual_intent('[{"position":1,"amount":200000},{"position":2,"amount":100000}]','LOCAL701 rollback intent',
   '379600a2-fd2d-4e6d-8004-b52b3d681740',key);
  ASSERT retry_result=first_result;
 ELSE
  BEGIN
   PERFORM pg_temp.save_manual_intent('[{"position":1,"amount":250000},{"position":2,"amount":50000}]','LOCAL701 rollback intent',
    '379600a2-fd2d-4e6d-8004-b52b3d681740',CASE WHEN scenario='stale' THEN gen_random_uuid() ELSE key END);
  EXCEPTION WHEN OTHERS THEN
   IF scenario='conflict' AND SQLERRM LIKE '%PAYOUT_EDIT_REQUEST_CONFLICT%'
    OR scenario='stale' AND SQLERRM LIKE '%PAYOUT_EDIT_STALE_RUN%' THEN rejected:=true;
   ELSE RAISE; END IF;
  END;
  ASSERT rejected, 'manual edit accepted a changed payload or stale tab intent';
 END IF;
 ASSERT (SELECT count(*)=before_count+1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08'),
  'same manual intent created another applied revision';
 ASSERT (SELECT count(*)=1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08' AND status='applied');
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PAYOUT701_MANUAL_REPLAY_CONFLICT_STALE_SCENARIO_ROLLBACK_PASS';
