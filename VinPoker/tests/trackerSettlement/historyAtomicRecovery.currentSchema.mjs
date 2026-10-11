import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
// Owned local qualification only. Synthetic outcome tests transactionality,
// not poker verifier correctness, publication or browser behavior.
const root=new URL('../../', import.meta.url);
const committedRecovery=process.argv.includes('--committed-recovery');
const database=process.env.PGDATABASE;
const port=Number(process.env.PGPORT);
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.match(database??'',/^vinpoker_ops_history_atomic_[a-z0-9_]+$/);
assert.ok(Number.isInteger(port)&&port>0&&port<=65535);
assert.equal(process.env.PGUSER,'postgres');
const execute=(args,input)=>spawnSync(process.platform==='win32'?'wsl':'psql',process.platform==='win32'?args:args.slice(1),{input,encoding:'utf8'});
const fixture=readFileSync(new URL('tests/trackerVoice/disposableDb.integration.sql',root),'utf8');
const fixtureBoundary=fixture.indexOf('INSERT INTO public.tracker_voice_configs');
assert.ok(fixtureBoundary>0,'voice fixture boundary missing');
let prefix=fixture.slice(0,fixtureBoundary)
 .replace('public.clubs(id, owner_id)','public.clubs(id, owner_id, name, region)')
 .replace("('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000001', '81100000-0000-4000-8000-000000000001','Atomic TEST','TEST')")
 .replace("('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000002', '81600000-0000-4000-8000-000000000001','Foreign TEST','TEST')")
 .replace('public.club_trackers(club_id, user_id)','public.club_trackers(club_id, user_id, granted_by)')
 .replace("('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001')","('81000000-0000-4000-8000-000000000001', '81400000-0000-4000-8000-000000000001','81100000-0000-4000-8000-000000000001')")
 .replace('public.tournaments(id, club_id, name, status)','public.tournaments(id, club_id, name, status, live_status)')
 .replace("'Voice V0 TEST', 'active')","'Voice V0 TEST', 'live','playing')")
 .replace("'Other Club TEST', 'active')","'Other Club TEST', 'live','playing')");
const start=prefix.indexOf('INSERT INTO public.dealers('),end=prefix.indexOf('INSERT INTO public.tournament_hands(',start);
assert.ok(start>0&&end>start); prefix=prefix.slice(0,start)+prefix.slice(end);
prefix=prefix.replace('INSERT INTO public.tournament_hands(',readFileSync(new URL('tests/trackerVoice/cardBatchIntegrity.roster.sql',root),'utf8')+'\nINSERT INTO public.tournament_hands(');
const sql=`BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database()<>'${database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>${port} OR current_user<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR EXISTS(SELECT 1 FROM public.clubs) THEN RAISE EXCEPTION 'wrong_local_fixture'; END IF;
 IF md5(replace(pg_get_functiondef('public.claim_tracker_historical_display_jobs_scoped_v1(uuid[],integer)'::regprocedure),chr(13),'')) IS DISTINCT FROM '328db0dbbe98c214e88337b3c012178e'
 OR md5(replace(pg_get_functiondef('public.commit_tracker_historical_display_outcome_v2(uuid,uuid,text,bigint,text,text,text,text,jsonb,uuid)'::regprocedure),chr(13),'')) IS DISTINCT FROM 'fcf8dac1239f25742e1c9566d523aa25' THEN RAISE EXCEPTION 'history_dependency_drift'; END IF;
END $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO anon,authenticated,service_role;
${prefix}
UPDATE public.hand_players SET ending_stack=starting_stack WHERE hand_id='86000000-0000-4000-8000-000000000001';
UPDATE public.tournament_hands SET status='completed' WHERE id='86000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
CREATE TEMP TABLE atomic_claim AS SELECT * FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY['86000000-0000-4000-8000-000000000001'::uuid],1);
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM atomic_claim)<>1 THEN RAISE EXCEPTION 'claim_missing'; END IF; END $$;
CREATE TEMP TABLE atomic_source AS SELECT * FROM public.get_tournament_historical_display_source_hash('86000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE atomic_payload AS SELECT jsonb_build_object('schemaVersion','settlement-outcome-v1','status','verified','sourceRevision',s.source_revision,'sourceChainHash',s.source_chain_hash,'settlementRevision',1,'outcomeHash',repeat('a',64),'ruleVersion','clockwise-first-eligible-winner-left-of-button/v1','pots','[]'::jsonb,'refunds','[]'::jsonb,'handRanks','[]'::jsonb,'totals','{}'::jsonb,'players',(SELECT jsonb_agg(jsonb_build_object('playerId',player_id,'startingStack',starting_stack,'endingStack',ending_stack,'committedTotal',0,'potAward',0,'refund',0,'creditedTotal',0,'netDelta',0,'externalDelta',0)) FROM public.hand_players WHERE hand_id='86000000-0000-4000-8000-000000000001')) payload FROM atomic_source s;
CREATE TEMP TABLE atomic_before AS SELECT jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision) snapshot FROM public.tracker_historical_display_queue q;
CREATE FUNCTION pg_temp.atomic_queue_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='completed' AND OLD.status='processing' THEN RAISE EXCEPTION 'owned_queue_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER atomic_queue_fault BEFORE UPDATE ON public.tracker_historical_display_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.atomic_queue_fault();
GRANT SELECT ON atomic_claim,atomic_source,atomic_payload TO service_role;
DO $$ DECLARE r jsonb; BEGIN
 PERFORM set_config('role','service_role',true);
 BEGIN
  SELECT public.commit_tracker_historical_display_outcome_v2(c.hand_id,'00000000-0000-4000-8000-000000000001','system_worker',s.source_revision,s.source_chain_hash,repeat('a',64),repeat('b',64),'atomic-history-probe-20261011',p.payload,c.lease_token) INTO r FROM atomic_claim c CROSS JOIN atomic_source s CROSS JOIN atomic_payload p;
  RAISE EXCEPTION 'fault_not_reached';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'owned_queue_failure' THEN RAISE; END IF; END;
 PERFORM set_config('role','none',true);
 IF EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes) OR (SELECT jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue q) IS DISTINCT FROM (SELECT snapshot FROM atomic_before) THEN RAISE EXCEPTION 'atomic_failure_partial_delta'; END IF;
END $$;
DROP TRIGGER atomic_queue_fault ON public.tracker_historical_display_queue;
GRANT SELECT ON atomic_claim,atomic_source,atomic_payload TO service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE atomic_success AS SELECT public.commit_tracker_historical_display_outcome_v2(c.hand_id,'00000000-0000-4000-8000-000000000001','system_worker',s.source_revision,s.source_chain_hash,repeat('a',64),repeat('b',64),'atomic-history-probe-20261011',p.payload,c.lease_token) receipt FROM atomic_claim c CROSS JOIN atomic_source s CROSS JOIN atomic_payload p;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT receipt->>'ok' FROM atomic_success) IS DISTINCT FROM 'true' OR (SELECT count(*) FROM public.tournament_settlement_outcomes)<>1 OR NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN atomic_claim c USING(hand_id,source_revision) WHERE q.status='completed' AND q.lease_token IS NULL AND q.lease_until IS NULL) THEN RAISE EXCEPTION 'atomic_success_gap'; END IF;
END $$;
CREATE TEMP TABLE atomic_committed_queue AS SELECT jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision) snapshot FROM public.tracker_historical_display_queue q;
CREATE TEMP TABLE atomic_committed_outcomes AS SELECT jsonb_agg(to_jsonb(o) ORDER BY id) snapshot FROM public.tournament_settlement_outcomes o;
DO $$ DECLARE r jsonb; BEGIN
 PERFORM set_config('role','service_role',true);
 BEGIN
  SELECT public.commit_tracker_historical_display_outcome_v2(c.hand_id,'00000000-0000-4000-8000-000000000001','system_worker',s.source_revision,s.source_chain_hash,repeat('a',64),repeat('b',64),'atomic-history-probe-20261011',p.payload,c.lease_token) INTO r FROM atomic_claim c CROSS JOIN atomic_source s CROSS JOIN atomic_payload p;
  RAISE EXCEPTION 'completed_lease_replay_accepted';
 EXCEPTION WHEN serialization_failure THEN IF SQLERRM<>'queue_lease_lost' THEN RAISE; END IF; END;
 PERFORM set_config('role','none',true);
 IF (SELECT jsonb_agg(to_jsonb(q) ORDER BY hand_id,source_revision) FROM public.tracker_historical_display_queue q) IS DISTINCT FROM (SELECT snapshot FROM atomic_committed_queue)
 OR (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o) IS DISTINCT FROM (SELECT snapshot FROM atomic_committed_outcomes) THEN RAISE EXCEPTION 'completed_lease_replay_delta'; END IF;
END $$;
${committedRecovery?'COMMIT;':'ROLLBACK;'}
`;
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const args=['psql','-X','-w','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'];
const result=execute(args,sql);
assert.equal(result.status,0,result.stderr+result.stdout);
if(committedRecovery){
 // Deliberately discard mutation stdout: recover only through a new connection.
 const recovery=execute(args,`BEGIN;
 SET LOCAL statement_timeout='15s';
 SET LOCAL lock_timeout='5s';
 DO $$ BEGIN
 IF current_database()<>'${database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>${port} THEN RAISE EXCEPTION 'wrong_recovery_target'; END IF;
 IF (SELECT count(*) FROM public.tournament_settlement_outcomes)<>1 OR NOT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN public.tournament_settlement_outcomes o ON o.hand_id=q.hand_id AND o.source_revision=q.source_revision WHERE q.hand_id='86000000-0000-4000-8000-000000000001' AND q.status='completed' AND q.lease_token IS NULL AND q.lease_until IS NULL) THEN RAISE EXCEPTION 'committed_recovery_missing'; END IF;
 END $$;
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
 SET LOCAL ROLE service_role;
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.claim_tracker_historical_display_jobs_scoped_v1(ARRAY['86000000-0000-4000-8000-000000000001'::uuid],1)) THEN RAISE EXCEPTION 'completed_job_reclaimed'; END IF; END $$;
 RESET ROLE;
 DO $$ BEGIN IF (SELECT count(*) FROM public.tournament_settlement_outcomes)<>1 THEN RAISE EXCEPTION 'recovery_duplicate'; END IF; END $$;
 ROLLBACK;`);
 assert.equal(recovery.status,0,recovery.stderr+recovery.stdout);
 console.log('HISTORY_COMMITTED_DISCARDED_RESPONSE_NEW_CONNECTION_RECOVERY_NO_RECLAIM_PASS');
}
console.log('HISTORY_OUTCOME_QUEUE_ATOMIC_FAILURE_ROLLBACK_SUCCESS_PASS');

