import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {runPaidCorrectionEdge} from './paidCorrectionEdge.native.mjs';
import {createPaidCompletedHandFixture} from '../cashier/paidJourney.fixture.mjs';
import {HistoricalDisplayVerificationError,verifyHistoricalDisplaySettlement} from '../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';
import {isUuid} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
import {authorizeHistoryWorker,HISTORY_CANARY_SECRET_ENV} from '../../supabase/functions/_shared/trackerSettlement/historyWorkerAuth.ts';
import {historicalWorkerFailureStatus,TRACKER_HISTORY_WORKER_MAX_BATCH,parseHistoryWorkerHandIds,requireHistoryCanaryScope,HISTORY_CANARY_SCOPE_ENV} from '../../supabase/functions/_shared/trackerSettlement/historyWorkerPolicy.ts';
import {computeAuthoritativeSettlement,normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';
// Actual worker/verifier/SQL, modeled HTTP/PostgREST/CORS. NO hosted credentials,
// provider, cron or outbound network. Dedicated dark canary hand scope only.
const database='vinpoker_ops_cash115_qualified_c';
const lostCommitResponse=process.argv.includes('--lost-commit-response');
const expiredLease=process.argv.includes('--expired-lease');
const correctionDuringCommit=process.argv.includes('--correct-during-commit');
const correctionEdge=process.argv.includes('--correction-edge');
const verified=process.argv.includes('--verified')||lostCommitResponse||expiredLease||correctionDuringCommit||correctionEdge;
let expiredOnce=false;
let correctionRevision;
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const parentHand=process.env.VINPOKER_HISTORY_PARENT_HAND;
const baselineParent=process.env.VINPOKER_HISTORY_PARENT_BASELINE;
assert.ok(!baselineParent||parentHand,'parent_hand_required');
let fixture,hand;
if(parentHand){
 assert.equal(process.env.VINPOKER_NATIVE_CORRECTION_UI,'1','owned_parent_ui_gate_required');assert.ok(isUuid(parentHand));
 assert.equal(verified,true);assert.ok(!lostCommitResponse&&!expiredLease&&!correctionDuringCommit&&!correctionEdge&&!process.argv.includes('--identity-revision'));
 assert.equal(sql('SELECT current_database();'),database);
 assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),'127.0.0.1|55441|17');
 const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 let raw;
 if(baselineParent){
  const f=JSON.parse(baselineParent);assert.ok(f&&['actor','tour','club','player','entry','registration'].every(key=>isUuid(f[key])),'owned_paid_fixture_required');
  raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',c.owner_id,'club',t.club_id) FROM public.tournament_hands h
   JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.clubs c ON c.id=t.club_id
   JOIN public.tournament_entries e ON e.id='${f.entry}' AND e.tournament_id=t.id AND e.player_id='${f.player}' AND e.registration_id='${f.registration}'
   JOIN public.hand_players hp ON hp.hand_id=h.id AND hp.player_id=e.player_id AND hp.entry_number=e.entry_no
   WHERE h.id='${parentHand}' AND h.tournament_id='${f.tour}' AND c.id='${f.club}' AND c.owner_id='${f.actor}' AND h.created_by=c.owner_id
    AND h.status='completed' AND NOT h.is_voided AND c.name='Cash identity local TEST' AND t.name='Cash identity local TEST'
    AND EXISTS(SELECT 1 FROM public.cashier_buyin_movements m WHERE m.registration_id=e.registration_id AND m.tournament_id=t.id AND m.amount>0)
    AND NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes o WHERE o.hand_id=h.id);`);
  assert.ok(raw,'owned_paid_parent_baseline_required');
 }else raw=sql(`SELECT jsonb_build_object('tour',h.tournament_id,'actor',o.actor_user_id,'club',t.club_id) FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id=h.tournament_id JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id AND o.source_revision=h.source_revision
  WHERE h.id='${parentHand}' AND h.status='completed' AND NOT h.is_voided AND o.status='verified' AND o.verification_scope='chain'
   AND o.correction_reason='TEST parent correction recovery';`);
 assert.ok(raw,'owned_parent_correction_required');const row=JSON.parse(raw);
 assert.ok(row&&isUuid(row.tour)&&isUuid(row.actor)&&isUuid(row.club));fixture=row;hand=parentHand;
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}' AND q.status='pending';`),'1');
}else({fixture,hand}=createPaidCompletedHandFixture(sql,{verified}));
const business=()=>sql(`SELECT jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
 'money',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'));`);
const before=business(),calls=[],errors=[];
const nonHandBusiness=()=>{const state=JSON.parse(business());delete state.hand;return JSON.stringify(state);};
const beforeNonHand=nonHandBusiness();
// Schema-only bootstrap omits hosted service_role BYPASSRLS. Match the existing
// native worker fixture pattern without changing application roles/policies.
const serviceTestRole='history_worker_'+crypto.randomUUID().replaceAll('-','');
sql(`CREATE ROLE ${serviceTestRole} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${serviceTestRole};`);
process.on('exit',()=>sql(`DROP ROLE ${serviceTestRole};`));
const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${serviceTestRole};`;
if(correctionEdge){await runPaidCorrectionEdge({sql,service,fixture,hand});process.exit(0);}
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
 if(expiredLease&&!expiredOnce&&name==='commit_tracker_historical_display_outcome_v2'){
  // Local fault fixture: expire only this exact worker lease, not business time.
  sql(`UPDATE public.tracker_historical_display_queue SET lease_until=now()-interval '1 second' WHERE hand_id='${hand}' AND lease_token=${quote(args.p_lease_token)}::uuid AND status='processing';`);
  expiredOnce=true;
 }
 if(correctionDuringCommit&&!correctionRevision&&name==='commit_tracker_historical_display_outcome_v2'){
  const readJson=(label,query)=>{const raw=sql(service+query);assert.ok(raw,label+' returned SQL NULL/no rows; privileged chip rows='+sql(`SELECT count(*) FROM public.tournament_chip_counts WHERE tournament_id='${fixture.tour}';`));return JSON.parse(raw);};
  const snapshot=readJson('correction snapshot',`SELECT public.get_tracker_historical_display_snapshot('${hand}',NULL);`);
  const liveStacks=readJson('correction live stacks',`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'chip_count',chip_count)) FROM public.tournament_chip_counts WHERE tournament_id='${fixture.tour}';`);
  const source=normalizeSettlementSourceRpcResult(readJson('chain source hash',`SELECT to_jsonb(s) FROM public.get_tournament_settlement_source_hash('${hand}') s;`));
  const corrected=await computeAuthoritativeSettlement({tournamentId:fixture.tour,targetHandId:hand,hands:[snapshot.hand],players:snapshot.players,actions:snapshot.actions,liveStacks,
   edit:{communityCards:['2c','3d','4h']},actor:{userId:fixture.actor,role:'club_owner_or_admin'},sourceRevisionOverride:source.sourceRevision,sourceChainHashOverride:source.sourceChainHash,settlementRevisionOverride:1});
  const receiptText=sql(service+`SELECT public.commit_tracker_hand_correction_outcome('${hand}','${fixture.actor}',${source.sourceRevision},${quote(source.sourceChainHash)},1,
   ${quote(corrected.privateOutcome.outcomeHash)},repeat('c',64),'native-worker-correction-${hand}',${quote(corrected.publicOutcome)}::jsonb,${quote(corrected.persistedEdit)}::jsonb,
   ${quote(corrected.handChanges)}::jsonb,${quote(corrected.finalStacks)}::jsonb,'TEST persisted board correction');`);
  assert.ok(receiptText,'canonical correction returned no receipt');
  const receipt=JSON.parse(receiptText);
  assert.equal(receipt.ok,true);
  correctionRevision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
  assert.ok(correctionRevision>args.p_expected_source_revision);
 }
 const data=JSON.parse(sql(service+query));
 // Inject transport loss only AFTER the real atomic SQL commit returned.
 // Do not roll back/requeue the committed outcome to make recovery pass.
 if(lostCommitResponse&&name==='commit_tracker_historical_display_outcome_v2'){
  assert.equal(data.ok,true);return {data:null,error:{message:'TEST_response_lost_after_commit'}};
 }
 return {data,error:null};
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
const result=await response.json();
if(correctionDuringCommit){
 assert.equal(response.status,503,JSON.stringify({result,errors}));
 assert.deepEqual(result,{ok:false,claimed:1,completed:0,retried:0,needs_attention:0,unresolved:1});
 assert.equal(errors.length,1);assert.match(errors[0],/stale_source_revision|queue_lease_lost/);
 assert.ok(correctionRevision);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=${correctionRevision} AND status='pending';`),'1');
 assert.equal(nonHandBusiness(),beforeNonHand,'board-only correction must preserve seats and cash');
 errors.length=0;
 const recovered=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
 assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),{ok:true,claimed:1,completed:1,retried:0,needs_attention:0,unresolved:0});
 assert.deepEqual(errors,[]);assert.equal(nonHandBusiness(),beforeNonHand);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND source_revision=${correctionRevision} AND status='verified';`),'1');
 const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
 const history=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
 assert.equal(history.items[0].result.status,'verified');
 console.log('ACTUAL_HISTORY_WORKER_CANONICAL_CORRECTION_REJECTS_OLD_REVISION_PASS');
}else if(expiredLease){
 assert.equal(response.status,503,JSON.stringify({result,errors}));
 assert.deepEqual(result,{ok:false,claimed:1,completed:0,retried:0,needs_attention:0,unresolved:1});
 assert.equal(errors.length,1);assert.match(errors[0],/queue_lease_lost/);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}';`),'0');
 assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' ORDER BY source_revision DESC LIMIT 1;`),'processing');
 assert.equal(business(),before);
 errors.length=0;
 const recovered=await handler(new Request('https://test.invalid/history-worker',{method:'POST',headers:{Authorization:'Bearer TEST_HISTORY_CANARY','Content-Type':'application/json'},body:JSON.stringify({hand_ids:[hand],limit:1})}));
 assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),{ok:true,claimed:1,completed:1,retried:0,needs_attention:0,unresolved:0});
 const commits=calls.filter(c=>c.name==='commit_tracker_historical_display_outcome_v2');
 assert.equal(commits.length,2);assert.notEqual(commits[0].args.p_lease_token,commits[1].args.p_lease_token);
 assert.deepEqual(errors,[]);assert.equal(business(),before);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified';`),'1');
 assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' ORDER BY source_revision DESC LIMIT 1;`),'completed');
 console.log('ACTUAL_HISTORY_WORKER_EXPIRED_LEASE_REJECT_THEN_RECLAIM_PASS');
}else{
assert.equal(response.status,lostCommitResponse?503:200,JSON.stringify({result,errors}));assert.deepEqual(errors,[]);
assert.deepEqual(result,{ok:!lostCommitResponse,claimed:1,completed:verified&&!lostCommitResponse?1:0,retried:0,needs_attention:verified?0:1,unresolved:lostCommitResponse?1:0});
assert.deepEqual(calls.map(c=>c.name),['claim_tracker_historical_display_jobs_scoped_v1','get_tracker_historical_display_snapshot',verified?'commit_tracker_historical_display_outcome_v2':'finish_tracker_historical_display_job',...(lostCommitResponse?['finish_tracker_historical_display_job']:[])]);
if(!verified)assert.equal(calls.at(-1).args.p_error_code,'historical_empty_or_invalid_pot');
assert.equal(sql(`SELECT status FROM public.tracker_historical_display_queue WHERE hand_id='${hand}' AND source_revision=(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}');`),verified?'completed':'needs_attention');
assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified';`),verified?'1':'0');
if(verified){const outcome=JSON.parse(sql(`SELECT public_outcome FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified';`));
 const winner=sql(`SELECT hp.player_id FROM public.hand_players hp JOIN public.tournament_hands h ON h.id=hp.hand_id WHERE h.id='${hand}' AND hp.seat_number=h.tracker_bb_position;`);
 assert.deepEqual(outcome.players.map(p=>p.netDelta).sort((a,b)=>a-b),[-100,100]);
 assert.equal(outcome.pots[0].allocations[0].winnerId,winner);assert.equal(outcome.pots[0].allocations[0].amount,200);
 assert.equal(outcome.refunds[0].playerId,winner);assert.equal(outcome.refunds[0].amount,100);assert.deepEqual(outcome.handRanks,[]);
 assert.equal(Object.hasOwn(outcome,'privateEvidence'),false);
}
const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
const history=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
assert.equal(history.items[0].result.status,verified?'verified':'needs_attention');assert.equal(business(),before);
if(process.argv.includes('--identity-revision')){
 assert.equal(verified,true);
 const revision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
 const other=sql(`SELECT id FROM public.tournament_tables WHERE tournament_id='${fixture.tour}' AND id<>'${logical}' ORDER BY id LIMIT 1;`);assert.ok(isUuid(other));
 let fkBlocked=false;
 try{sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET tournament_table_id='${other}' WHERE id='${hand}';ROLLBACK;`);}
 catch(error){fkBlocked=String(error.stderr??error).includes('tournament_hands_table_session_match_v3_fkey');}
 assert.equal(fkBlocked,true,'mismatched non-null session tuple must be rejected');assert.equal(business(),before);
 const noOp=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET updated_at=updated_at WHERE id='${hand}';RESET ROLE;
  SELECT jsonb_build_object('revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'));ROLLBACK;`));
 assert.equal(noOp.revision,revision);assert.equal(noOp.verified,1);
 for(const [assignment,target] of [['table_id=NULL',logical],['table_session_id=NULL',logical],[`table_session_id=NULL,tournament_table_id='${other}'`,other]]){
 const probe=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${fixture.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${fixture.actor}"}';SET LOCAL ROLE authenticated;
  UPDATE public.tournament_hands SET ${assignment} WHERE id='${hand}';RESET ROLE;
  SELECT jsonb_build_object('moved',(SELECT tournament_table_id='${target}' FROM public.tournament_hands WHERE id='${hand}'),
   'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),
   'pending',(SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}' AND q.status='pending'),
   'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'),
   'public',(SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${target}',20,NULL,NULL)));ROLLBACK;`));
 assert.equal(business(),before,'identity diagnostic must rollback all business rows');
 assert.ok(!probe.moved||probe.revision>revision,'IDENTITY_REPARENT_WITHOUT_REVISION '+JSON.stringify(probe));
 if(probe.moved){assert.equal(probe.verified,0);assert.equal(probe.pending,1);assert.notEqual(probe.public.items[0].result.status,'verified');}
 }
 console.log('PAID_VERIFIED_HAND_IDENTITY_REPARENT_REVISION_FENCE_PASS');
 const sourceRows=()=>sql(`SELECT jsonb_build_object('actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'));`);
 const originalRows=sourceRows();
 // Trigger coverage only: privileged source writes, not endpoint authority proof.
 // Each vector begins from the same genuine worker-verified paid hand.
 for(const [name,mutation] of [
  ['action amount',`UPDATE public.hand_actions SET action_amount=action_amount+1 WHERE id=(SELECT id FROM public.hand_actions WHERE hand_id='${hand}' ORDER BY id LIMIT 1)`],
  ['action delete',`DELETE FROM public.hand_actions WHERE id=(SELECT id FROM public.hand_actions WHERE hand_id='${hand}' ORDER BY id DESC LIMIT 1)`],
  ['hole cards',`UPDATE public.hand_players SET hole_cards='["2c","3d"]'::jsonb WHERE id=(SELECT id FROM public.hand_players WHERE hand_id='${hand}' ORDER BY id LIMIT 1)`],
  ['participant stack',`UPDATE public.hand_players SET ending_stack=ending_stack+1 WHERE id=(SELECT id FROM public.hand_players WHERE hand_id='${hand}' ORDER BY id LIMIT 1)`],
  ['board',`UPDATE public.tournament_hands SET community_cards='["2c","3d","4h"]'::jsonb WHERE id='${hand}'`],
  ['blind',`UPDATE public.tournament_hands SET tracker_big_blind=tracker_big_blind+1 WHERE id='${hand}'`],
  ['void',`UPDATE public.tournament_hands SET is_voided=true WHERE id='${hand}'`],
 ]){
  const probe=JSON.parse(sql(`BEGIN;${mutation};SELECT jsonb_build_object(
   'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),
   'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'),
   'queued',(SELECT count(*) FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='${hand}'),
   'public',(SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL)));ROLLBACK;`));
  assert.ok(probe.revision>revision,name+' must advance source revision');
  assert.equal(probe.verified,0,name+' must invalidate proof');
  if(name!=='void')assert.equal(probe.queued,1,name+' must enqueue current generation');
  assert.ok(!probe.public.items.some(item=>item.result?.status==='verified'),name+' must not publish old proof');
  assert.equal(business(),before,name+' business rollback');assert.equal(sourceRows(),originalRows,name+' source rollback');
 }
 console.log('PAID_VERIFIED_SOURCE_TRIGGER_MUTATION_MATRIX_PASS');
 const projectionQuery=`SELECT jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${fixture.tour}'),
  'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${hand}'),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${fixture.tour}'),
  'money',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${fixture.tour}'),
  'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tournament_chip_counts c WHERE tournament_id='${fixture.tour}'),
  'proofs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${hand}'),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${hand}'))`;
 const projection=()=>sql(projectionQuery);
 const originalProjection=projection();
 for(const actor of [fixture.player,fixture.actor]){
  const probe=JSON.parse(sql(`BEGIN;CREATE TEMP TABLE void_before AS SELECT (${projectionQuery}) snapshot;
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;
   CREATE TEMP TABLE void_probe AS SELECT public.void_last_hand('${hand}') receipt;RESET ROLE;
   SELECT jsonb_build_object('receipt',(SELECT receipt FROM void_probe),'unchanged',(SELECT snapshot=(${projectionQuery}) FROM void_before),
    'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${hand}'),
    'voided',(SELECT is_voided FROM public.tournament_hands WHERE id='${hand}'),
    'verified',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND status='verified'),
    'restored',(SELECT bool_and(e.current_stack=hp.starting_stack AND s.chip_count=hp.starting_stack AND c.chip_count=hp.starting_stack)
      FROM public.hand_players hp JOIN public.tournament_entries e ON e.tournament_id='${fixture.tour}' AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
      JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
      JOIN public.tournament_chip_counts c ON c.tournament_id=e.tournament_id AND c.player_id=e.player_id AND c.entry_number=e.entry_no WHERE hp.hand_id='${hand}'),
    'public',(SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL)));ROLLBACK;`));
  if(actor===fixture.actor){
   assert.equal(probe.receipt.status,'success',JSON.stringify(probe));assert.equal(probe.voided,true);
   assert.ok(probe.revision>revision);assert.equal(probe.verified,0);assert.equal(probe.restored,true);
   assert.ok(!probe.public.items.some(item=>item.result?.status==='verified'));
  }else{assert.equal(probe.receipt.error,'actor_not_allowed');assert.equal(probe.unchanged,true,'denied void must have zero delta before rollback');assert.equal(probe.revision,revision);assert.equal(probe.voided,false);assert.equal(probe.verified,1);}
  assert.equal(business(),before,'void endpoint rollback business');assert.equal(sourceRows(),originalRows,'void endpoint rollback source');
  assert.equal(projection(),originalProjection,'void endpoint rollback projections/proofs/queue');
 }
 console.log('PAID_VERIFIED_VOID_ENDPOINT_OWNER_PLAYER_AUTH_PROJECTIONS_PASS');
}
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
assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified';`),verified?'1':'0');
if(parentHand)console.log(baselineParent?'ACTUAL_PAID_PARENT_BASELINE_HISTORY_WORKER_PUBLIC_PASS':'ACTUAL_PARENT_CORRECTION_SAME_HAND_CURRENT_REVISION_WORKER_PUBLIC_PASS');
console.log(lostCommitResponse?'ACTUAL_HISTORY_WORKER_LOST_COMMIT_RESPONSE_NO_DUPLICATE_PASS':verified?'ACTUAL_HISTORY_WORKER_VERIFIER_PAID_FOLD_OUTCOME_PUBLIC_VERIFIED_PASS':'ACTUAL_HISTORY_WORKER_VERIFIER_PAID_HAND_NEEDS_ATTENTION_PUBLIC_STATE_PASS');
}
