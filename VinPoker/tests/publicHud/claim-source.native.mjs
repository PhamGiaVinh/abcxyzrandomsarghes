import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {initialize,sql,jsonSql,sqlAsync,service} from './nativeDb.mjs';

if(process.argv.includes('--initialize'))initialize();
const signature='public.claim_public_hud_jobs_with_source_v1(integer)';
const protectedSql="SELECT jsonb_agg(jsonb_build_object('oid',oid,'definition',md5(pg_get_functiondef(oid)),'acl',proacl,'owner',proowner) ORDER BY oid) FROM pg_proc WHERE oid IN ('public.claim_public_hud_jobs_v1(integer)'::regprocedure,'public.get_public_hud_job_source_v1(text,uuid,bigint,uuid)'::regprocedure,'public.publish_public_hud_hand_v1(uuid,bigint,uuid,text,jsonb)'::regprocedure);";
const before=jsonSql(protectedSql);
assert.equal(sql(`SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='${signature}'::regprocedure;`),'t');
for(const role of ['anon','authenticated'])assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE ${role};SELECT ${signature.split('(')[0]}(20);ROLLBACK;`),/permission denied/);
assert.throws(()=>sql("BEGIN;SET LOCAL request.jwt.claim.role='authenticated';SELECT public.claim_public_hud_jobs_with_source_v1(20);ROLLBACK;"),/forbidden/);
for(const limit of ['NULL','0','81'])assert.throws(()=>sql(`BEGIN;${service}SELECT public.claim_public_hud_jobs_with_source_v1(${limit});ROLLBACK;`),/invalid_limit/);
const fixture=`
 INSERT INTO public.tournaments(id) VALUES('ba100000-0000-4000-8000-000000000001');
 INSERT INTO public.tournament_hands(id,tournament_id,hand_number)
 SELECT ('ba200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ba100000-0000-4000-8000-000000000001',n FROM generate_series(1,20)n;
 INSERT INTO public.hand_players(hand_id,tournament_id,player_id,seat_number,starting_stack)
 SELECT id,tournament_id,'ba300000-0000-4000-8000-000000000001',1,1000 FROM public.tournament_hands WHERE tournament_id='ba100000-0000-4000-8000-000000000001';
 DELETE FROM tracker_analytics_v1.jobs;
 SELECT tracker_analytics_v1.enqueue('hand',id) FROM public.tournament_hands WHERE tournament_id='ba100000-0000-4000-8000-000000000001';
`;
const result=jsonSql(`BEGIN;${fixture}${service}
 CREATE TEMP TABLE claims AS SELECT public.claim_public_hud_jobs_with_source_v1(20) packet;
 SELECT jsonb_build_object('claims',jsonb_array_length(packet),'bytes',octet_length(packet::text),
  'sourcesReady',(SELECT count(*) FROM jsonb_array_elements(packet) j WHERE j->'source_error'='false'::jsonb AND j->'source'->'hand'->>'handId'=j->>'entity_id'),
  'exactSource',(SELECT bool_and(j->'source'=public.get_public_hud_job_source_v1(j->>'kind',(j->>'entity_id')::uuid,(j->>'generation')::bigint,(j->>'lease_token')::uuid)) FROM jsonb_array_elements(packet) j))
 FROM claims;ROLLBACK;`);
assert.equal(result.claims,20);assert.equal(result.sourcesReady,20);assert.equal(result.exactSource,true);

// A malformed raw source must poison only its own packet, not the whole claim.
const failed=jsonSql(`BEGIN;${fixture}
 UPDATE public.tournament_hands SET community_cards='"not-an-array"'::jsonb WHERE hand_number=1;
 ${service}WITH packet AS (SELECT public.claim_public_hud_jobs_with_source_v1(20) items)
 SELECT jsonb_build_object('claims',jsonb_array_length(items),
  'errors',(SELECT count(*) FROM jsonb_array_elements(items) j WHERE j->'source_error'='true'::jsonb AND j->'source'='null'::jsonb),
  'ready',(SELECT count(*) FROM jsonb_array_elements(items) j WHERE j->'source_error'='false'::jsonb AND j->'source'->'hand' IS NOT NULL)) FROM packet;ROLLBACK;`);
assert.deepEqual(failed,{claims:20,errors:1,ready:19});

const fenced=jsonSql(`BEGIN;${fixture}${service}
 CREATE TEMP TABLE claim_fence AS SELECT value j FROM jsonb_array_elements(public.claim_public_hud_jobs_with_source_v1(20));
 RESET ROLE;
 UPDATE public.tournament_hands SET is_voided=true,source_revision=source_revision+1 WHERE hand_number=1;
 UPDATE tracker_analytics_v1.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE entity_id IN(SELECT id FROM public.tournament_hands WHERE hand_number=2);
 ${service}SELECT jsonb_agg(jsonb_build_object('staleRejected',NOT public.publish_public_hud_hand_v1((j->>'entity_id')::uuid,(j->>'generation')::bigint,(j->>'lease_token')::uuid,j->'source'->>'fingerprint','[]'::jsonb)))
 FROM claim_fence WHERE j->>'entity_id' IN('ba200000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000002');ROLLBACK;`);
assert.equal(fenced.length,2);assert.ok(fenced.every(row=>row.staleRejected===true));
const skew=jsonSql(`BEGIN;${fixture.replace('generate_series(1,20)','generate_series(1,80)')}
 INSERT INTO public.hand_actions(hand_id,player_id,street,action_type,action_amount,action_order)
 SELECT 'ba200000-0000-4000-8000-000000000001','ba300000-0000-4000-8000-000000000001','preflop','call',1,n FROM generate_series(1,1000)n;
 ${service}WITH packet AS MATERIALIZED(SELECT public.claim_public_hud_jobs_with_source_v1(80) items)
 SELECT jsonb_build_object('claims',jsonb_array_length(items),'bytes',octet_length(items::text),
  'errors',(SELECT count(*) FROM jsonb_array_elements(items) j WHERE j->'source_error'='true'::jsonb),
  'largestActions',(SELECT max(jsonb_array_length(j->'source'->'hand'->'actions')) FROM jsonb_array_elements(items) j)) FROM packet;ROLLBACK;`);
assert.equal(skew.claims,80);assert.equal(skew.errors,0);assert.equal(skew.largestActions,1000);
const body=text=>text.replace(/^\s*--[^\n]*\n/gm,'').replace(/^\s*BEGIN;/,'').replace(/COMMIT;\s*$/,'');
const reverse=body(readFileSync('tests/publicHud/claim-source.rollback.sql','utf8'));
assert.equal(sql(`BEGIN;${reverse}SELECT to_regprocedure('${signature}') IS NULL;ROLLBACK;`),'t');
assert.throws(()=>sql(`BEGIN;ALTER FUNCTION ${signature} SECURITY INVOKER;${reverse}ROLLBACK;`),/definition or ACL drift/);
assert.throws(()=>sql(`BEGIN;${body(readFileSync('supabase/migrations/20261105213000_public_hud_claim_source_batch.sql','utf8'))}ROLLBACK;`),/dependency_drift/);
// Two actual connections claim disjoint batches. While the first transaction
// retains its queue locks, a canonical source update waits rather than deadlocks.
sql(`BEGIN;${fixture}
 UPDATE tracker_analytics_v1.jobs SET oldest_pending_at=timestamp '2026-01-01'+make_interval(secs=>(right(entity_id::text,12))::integer);
 COMMIT;`);
const holding=sqlAsync(`BEGIN;SET LOCAL application_name='hud_claim_source_holder';${service}
 SELECT public.claim_public_hud_jobs_with_source_v1(10);SELECT pg_sleep(2);COMMIT;`);
const waitFor=async(query,label)=>{
 for(let i=0;i<100;i++){
  if(sql(query)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error(label);
};
await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='hud_claim_source_holder' AND wait_event='PgSleep');",'Claim holder did not reach pause');
const second=jsonSql(`${service}SELECT public.claim_public_hud_jobs_with_source_v1(10);`);
const sourceWriter=sqlAsync("SET application_name='hud_claim_source_writer';UPDATE public.tournament_hands SET source_revision=source_revision+1 WHERE id='ba200000-0000-4000-8000-000000000001';");
await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='hud_claim_source_writer' AND h.application_name='hud_claim_source_holder' AND w.wait_event_type='Lock');",'Source writer did not wait on held claim');
const first=JSON.parse((await holding).split('\n').find(line=>line.startsWith('[')));
await sourceWriter;
assert.equal(first.length,10);assert.equal(second.length,10);
assert.equal(new Set([...first,...second].map(job=>job.entity_id)).size,20);
const stale=first.find(job=>job.entity_id==='ba200000-0000-4000-8000-000000000001');
assert.ok(stale);
assert.equal(sql(`${service}SELECT public.publish_public_hud_hand_v1('${stale.entity_id}',${stale.generation},'${stale.lease_token}','${stale.source.fingerprint}','[]'::jsonb);`),'f');
assert.deepEqual(jsonSql(protectedSql),before);
const report={kind:'NATIVE_BATCHED_CLAIM_SOURCE_CORRECTNESS_NOT_LOAD',passed:true,result,failed,fenced,skew,exactReverse:true,
  concurrency:{first:first.length,second:second.length,distinct:20,sourceWriterWaited:true,staleAfterWaitRejected:true},
  wrapperHash:sql(`SELECT md5(replace(pg_get_functiondef('${signature}'::regprocedure),chr(13),''));`),
  checks:['service-only-and-actor-role','original-limit','same-transaction-source-parity','one-getter-error-isolated','changed-source-rejected','expired-lease-rejected','canonical-definitions-acls-preserved'],
  limitations:'Native fixtures include a synthetic1000-action source packet,not a legal poker trace. No source-write overhead under audience load or HTTP latency qualification yet'};
if(process.env.PUBLIC_HUD_CLAIM_SOURCE_REPORT)writeFileSync(process.env.PUBLIC_HUD_CLAIM_SOURCE_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
