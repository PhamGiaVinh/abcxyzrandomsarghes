import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1177_LOCAL,'1');
const candidate=process.env.VINPOKER_EARLYITM1177_CANDIDATE==='1';
const attempt=process.env.VINPOKER_EARLYITM1177_ATTEMPT;assert.match(attempt??'',/^[a-z0-9]+$/);
const base='D:/Quy trình/output/reports/earlyitm1177-obligation-read-'+(candidate?'green':'red')+attempt+'-local-20261028';assert.equal(existsSync(base+'.sql'),false);
const baseline=JSON.parse(readFileSync('D:/Quy trình/output/reports/earlyitm1177-read-state-baseline-local-20261028.json','utf8'));
const f=baseline.fixture,literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const source=readFileSync('supabase/pending-migrations/20261027184903_multiday_individual_obligation_read_state_v1.sql','utf8');
const guard=String.raw`DO $$ BEGIN ASSERT current_database()='vinpoker_earlyitm1172_local';ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));END $$;`;
const tables=['public.tournaments','public.tournament_entries','public.tournament_seats','public.tournament_prize_payments','public.cashier_buyin_movements','public.multi_day_payout_finalizations_v1','public.tournament_close_report','private.multi_day_individual_results_v1','private.multi_day_individual_rank_requests_v1','private.multi_day_individual_obligations_v1','private.multi_day_individual_obligation_requests_v1','private.multi_day_individual_payment_commits_v1','floor_private.payout_payment_receipts_v1'];
const fingerprint=`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM ${t} x)`).join(',')})::text)`;
let sql='BEGIN;'+guard+"SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';CREATE TEMP TABLE obligation1177_before AS "+fingerprint+";CREATE TEMP TABLE obligation1177_acl AS SELECT proacl FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure;\n"+(candidate?source:'')+`
SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $test$ DECLARE result jsonb;BEGIN
 result:=public.get_multi_day_individual_rank_review_v1('${f.event}');
 ASSERT result->'individualObligations'=${literal(JSON.stringify([baseline.catalog.persistedObligation]))}::jsonb,'persisted individual obligation not visible after reload';
 ASSERT result-'individualObligations'=${literal(JSON.stringify(baseline.review))}::jsonb,'existing rank/source fields changed';
 PERFORM set_config('test.e1177.read',result::text,true);
END $test$;
RESET ROLE;
SELECT jsonb_build_object('read',current_setting('test.e1177.read')::jsonb,'bodyHash',(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure),'aclUnchanged',(SELECT proacl FROM obligation1177_acl) IS NOT DISTINCT FROM (SELECT proacl FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure));
DO $test$ BEGIN ASSERT (SELECT md5 FROM obligation1177_before)=(${fingerprint}),'read patch changed business data';END $test$;
ROLLBACK;
DO $test$ BEGIN ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure)='${baseline.catalog.bodyHash}';END $test$;
SELECT jsonb_build_object('rolledBack',true,'baselineBodyRestored',true,'businessTablesChecked',13);
`;
if(process.env.VINPOKER_EARLYITM1177_HISTORY_DOWN==='1'){
 assert.equal(candidate,true);const down=readFileSync('tests/cashier/earlyItm1177.obligation-read.down.sql','utf8');
 const anchor='RESET ROLE;\nSELECT jsonb_build_object';assert.equal(sql.split(anchor).length,2);
 sql=sql.replace(anchor,()=>String.raw`RESET ROLE;
DO $test$ BEGIN
 BEGIN
  EXECUTE convert_from(decode('`+Buffer.from(down,'utf8').toString('hex')+String.raw`','hex'),'UTF8');
  RAISE EXCEPTION 'read down removed persisted debt visibility';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_obligation_read_history_retained_use_forward_repair' THEN RAISE;END IF;END;
END $test$;
SELECT jsonb_build_object('historyDownRefused',true);
`+anchor);
}
writeFileSync(base+'.sql',sql);
try{
 const raw=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_earlyitm1172_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000,maxBuffer:4e6,stdio:['pipe','pipe','pipe']});
 const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).baselineBodyRestored,true);assert.equal(observations.find(x=>x.read).aclUnchanged,true);
 writeFileSync(base+'.json',JSON.stringify({kind:'PERSISTED_INDIVIDUAL_OBLIGATION_READ_NATIVE_OUTER_ROLLBACK',observations,durablyApplied:false,fullR03Accepted:false},null,2));
 console.log('EARLYITM1177_PERSISTED_100K_VISIBLE_SOURCE_IDENTITY_ACL_DATA_UNCHANGED_ROLLBACK_PASS');
}catch(error){writeFileSync(base+'.failure.log',String(error.stderr??error.stack));throw error;}
