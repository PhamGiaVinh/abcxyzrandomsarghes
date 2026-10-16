import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';
import {HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement} from '../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';
import {isUuid} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
import {authorizeHistoryWorker,HISTORY_CANARY_SECRET_ENV} from '../../supabase/functions/_shared/trackerSettlement/historyWorkerAuth.ts';
import {historicalWorkerFailureStatus,TRACKER_HISTORY_WORKER_MAX_BATCH,parseHistoryWorkerHandIds,requireHistoryCanaryScope,HISTORY_CANARY_SCOPE_ENV} from '../../supabase/functions/_shared/trackerSettlement/historyWorkerPolicy.ts';
import {normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';
// Actual worker/verifier/SQL, modeled HTTP/PostgREST/CORS. NO hosted credentials,
// provider, cron or outbound network. Dedicated dark canary hand scope only.
const database='vinpoker_ops_cash115_qualified_c';
const verified=process.argv.includes('--verified');
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const fixture=createPaidJourneyFixture(sql);
let journey=readFileSync(new URL('../cashier/paidActiveHand.pg17.sql',import.meta.url),'utf8');
assert.match(journey,/ROLLBACK;\s*SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';/);
journey=journey.replace(/ROLLBACK;(\s*SELECT 'ACTUAL_HAND_PAID_WAIT_FINISH_PENDING_MODE_THEN_SEAT_PASS';)/,'COMMIT;$1');
sql(String.raw`\set PAID_REGISTRATION ${fixture.registration}
\set PAID_MOVE_CASE false
\set PAID_CORRECTION_CASE false
\set PAID_VERIFIED_HAND ${verified?'true':'false'}
`+journey);
const hand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${fixture.tour}' AND status='completed';`);assert.ok(isUuid(hand));
const business=()=>sql(`SELECT jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
 'money',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'));`);
const before=business(),calls=[],errors=[];
const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE service_role;`;
const types={claim_tracker_historical_display_jobs_scoped_v1:{p_limit:'integer',p_hand_ids:'uuid[]'},
 get_tracker_historical_display_snapshot:{p_hand_id:'uuid',p_tournament_id:'uuid'},
 finish_tracker_historical_display_job:{p_hand_id:'uuid',p_source_revision:'bigint',p_lease_token:'uuid',p_status:'text',p_error_code:'text'},
 commit_tracker_historical_display_outcome_v2:{p_hand_id:'uuid',p_actor_user_id:'uuid',p_actor_kind:'text',p_expected_source_revision:'bigint',
  p_expected_source_chain_hash:'text',p_outcome_hash:'text',p_request_hash:'text',p_idempotency_key:'text',p_public_outcome:'jsonb',p_lease_token:'uuid'}};
const quote=v=>v===null?'NULL':`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
const client={rpc:async(name,args)=>{try{
 const schema=types[name];assert.ok(schema,'unexpected worker RPC '+name);assert.deepEqual(Object.keys(args).sort(),Object.keys(schema).sort());
 calls.push({name,args});const params=Object.entries(args).map(([k,v])=>`${k}=>${Array.isArray(v)?`ARRAY[${v.map(quote).join(',')}]`:quote(v)}::${schema[k]}`).join(',');
 const query=name==='claim_tracker_historical_display_jobs_scoped_v1'?`SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.${name}(${params}) r;`:`SELECT to_jsonb(public.${name}(${params}));`;
 return {data:JSON.parse(sql(service+query)),error:null};
 }catch(error){errors.push(String(error));return {data:null,error:{message:String(error)}};}},
 from(table){assert.equal(table,'tournament_settlement_outcomes');let id;const query={select:columns=>{assert.equal(columns,'settlement_revision');return query;},
  eq:(key,value)=>{assert.equal(key,'hand_id');assert.equal(value,hand);id=value;return query;},order:(key)=>{assert.equal(key,'settlement_revision');return query;},
  limit:async n=>{assert.equal(n,1);try{return {data:JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT settlement_revision FROM public.tournament_settlement_outcomes WHERE hand_id='${id}' ORDER BY settlement_revision DESC LIMIT 1) x;`)),error:null};}
   catch(error){errors.push(String(error));return {data:null,error:{message:String(error)}};}}};return query;}};
const file=readFileSync(new URL('../../supabase/functions/tournament-historical-settlement-worker/index.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('index.ts',file,ts.ScriptTarget.ES2022,true);
const stripped=ts.factory.updateSourceFile(ast,ast.statements.filter(n=>!ts.isImportDeclaration(n)));
const code=ts.transpileModule(ts.createPrinter().printFile(stripped),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
let handler;const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'TEST_HISTORY_SERVICE',
 TRACKER_HISTORY_COMPLETION_WORKER_ENABLED:'false',[HISTORY_CANARY_SECRET_ENV]:'TEST_HISTORY_CANARY',[HISTORY_CANARY_SCOPE_ENV]:JSON.stringify([hand])};
runInNewContext(code,{Request,Response,TextEncoder,Error,crypto:globalThis.crypto,console,
 handleOptions:()=>null,jsonResp:(_req,value,status=200)=>new Response(JSON.stringify(value),{status}),createClient:()=>client,
 HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement,canonicalJsonV1,isUuid,authorizeHistoryWorker,HISTORY_CANARY_SECRET_ENV,
 historicalWorkerFailureStatus,TRACKER_HISTORY_WORKER_MAX_BATCH,parseHistoryWorkerHandIds,requireHistoryCanaryScope,HISTORY_CANARY_SCOPE_ENV,normalizeSettlementSourceRpcResult,
 Deno:{serve:fn=>handler=fn,env:{get:key=>env[key]}}});
const response=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
const result=await response.json();assert.equal(response.status,200,JSON.stringify({result,errors}));assert.deepEqual(errors,[]);
assert.deepEqual(result,{ok:true,claimed:1,completed:verified?1:0,retried:0,needs_attention:verified?0:1,unresolved:0});
assert.deepEqual(calls.map(c=>c.name),['claim_tracker_historical_display_jobs_scoped_v1','get_tracker_historical_display_snapshot',verified?'commit_tracker_historical_display_outcome_v2':'finish_tracker_historical_display_job']);
if(!verified)assert.equal(calls.at(-1).args.p_error_code,'historical_empty_or_invalid_pot');
assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}');`),verified?'completed':'needs_attention');
assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified';`),verified?'1':'0');
if(verified){const outcome=JSON.parse(sql(`SELECT public_outcome FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified';`));
 const winner=sql(`SELECT hp.player_id FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id WHERE h.id='${hand}' AND hp.seat_number=h.tracker_bb_position;`);
 assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-100,100]);
 assert.equal(outcome.pots[0].allocations[0].winnerId,winner);assert.equal(outcome.pots[0].allocations[0].amount,200);
 assert.equal(outcome.refunds[0].playerId,winner);assert.equal(outcome.refunds[0].amount,100);assert.deepEqual(outcome.handRanks,[]);
 assert.equal(Object.hasOwn(outcome,'privateEvidence'),false);
}
const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
const history=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
assert.equal(history.items[0].result.status,verified?'verified':'needs_attention');assert.equal(business(),before);
const observed=calls.length;
for(const [credential,body,status,expectedCode] of [
 ['TEST_HISTORY_SERVICE',{hand_ids:[hand],limit:1},404,'worker_disabled'],
 ['TEST_HISTORY_CANARY',{limit:1},400,'hand_scope_required'],
 ['TEST_HISTORY_CANARY',{hand_ids:['00000000-0000-4000-8000-000000000099'],limit:1},400,'hand_out_of_scope'],
]){
 const denied=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 assert.equal(denied.status,status);assert.equal((await denied.json()).code,expectedCode);assert.equal(calls.length,observed,'denied scope must not call SQL');
}
const retry=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
assert.equal(retry.status,200);assert.deepEqual(await retry.json(),{ok:true,claimed:0,completed:0,retried:0,needs_attention:0,unresolved:0});
assert.equal(calls.at(-1).name,'claim_tracker_historical_display_jobs_scoped_v1');assert.deepEqual(errors,[]);assert.equal(business(),before);
console.log(verified?'ACTUAL_HISTORY_WORKER_VERIFIER_PAID_FOLD_OUTCOME_PUBLIC_VERIFIED_PASS':'ACTUAL_HISTORY_WORKER_VERIFIER_PAID_HAND_NEEDS_ATTENTION_PUBLIC_STATE_PASS');
