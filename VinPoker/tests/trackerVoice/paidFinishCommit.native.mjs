import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseSync,transformSync} from '@swc/core';
import {createPaidJourneyFixture} from '../cashier/paidJourney.fixture.mjs';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {reduceHand,isBettingRoundComplete,isRunout} from '../../src/lib/tracker-poker/handStateCore.ts';
import {buildVoiceFinishCanonicalRequest,voiceCanonicalRequestsMatch} from '../../src/lib/trackerVoice/canonicalRequest.ts';
import {actionWorkflowForStreet} from '../../src/lib/trackerVoice/canonicalRequest.ts';
import {routeTrackerVoiceIntent} from '../../src/lib/trackerVoice/intentRouter.ts';

// Durable isolated SQL/engine/client proof. No hosted HTTP/Auth/provider/browser.
assert.equal(process.env.VINPOKER_NATIVE_VOICE_FINISH,'1');
const database='vinpoker_ops_cash115_qualified_c';
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const quote=value=>`'${(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll("'","''")}'`;
const f=createPaidJourneyFixture(sql);
assert.equal(sql("SELECT has_function_privilege('service_role','public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb)','EXECUTE') AND NOT has_table_privilege('service_role','public.tracker_voice_events','SELECT');"),'t');
const resolverMetadata=()=>sql("SELECT md5(pg_get_functiondef(oid)||proacl::text||proconfig::text) FROM pg_proc WHERE oid='public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb)'::regprocedure;");
const resolverBefore=resolverMetadata();
const migration=readFileSync(new URL('../../supabase/migrations/20270128000121_tracker_voice_finish_receipt_resolution_v1.sql',import.meta.url),'utf8');
assert.match(migration,/^BEGIN;$/m);assert.match(migration,/COMMIT;\s*$/);
sql('BEGIN;DROP FUNCTION public.resolve_tracker_voice_finish_intent_v1(uuid,jsonb);\n'+migration.replace(/^BEGIN;$/m,'').replace(/COMMIT;\s*$/,'')+'\nROLLBACK;');
assert.equal(resolverMetadata(),resolverBefore,'transactional migration rehearsal restores exact definition/ACL/config');
const table=JSON.parse(sql(`SELECT to_jsonb(t) FROM public.tournament_tables t JOIN public.tournament_seats s ON s.tournament_table_id=t.id WHERE s.entry_id='${f.entry}' AND s.is_active;`));
const floorActor=crypto.randomUUID();
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
const serviceBypassBefore=sql("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';");
const globalBefore=sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');");
try{
 // Reuse the existing paid registration/open/Voice setup exactly, not a second fixture writer.
 const journey=readFileSync(new URL('./runtimeApiPayload.test.mjs',import.meta.url),'utf8');
 const start='const payload=JSON.parse(sql(`',end=" INSERT INTO native_voice_payloads VALUES('owner_active'";
 assert.equal(journey.split(start).length,2);assert.equal(journey.split(end).length,2);
 const setup=journey.split(start)[1].split(end)[0];
 sql(runInNewContext('`'+setup+'COMMIT;`',{f,table,floorActor}));
 const hand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress';`);
 assert.match(hand,/^[0-9a-f-]{36}$/);
 const players=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY seat_number) FROM public.hand_players p WHERE hand_id='${hand}';`));
 assert.equal(players.length,2);
 for(const [player,type,order,amount] of [[players[0],'post_sb',1,100],[players[1],'post_bb',2,200],[players[0],'fold',3,0]]){
  const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.record_action('${hand}','${player.player_id}','${type}',${order},${player.entry_number},'preflop',${amount});COMMIT;`));
  assert.equal(r.status,'success');
 }
 const snapshot=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}','${hand}');COMMIT;`));
 assert.equal(snapshot.ok,true);
 const runtime=reduceHand(snapshot.players,snapshot.actions,snapshot.button_seat);
 assert.equal(runtime.players.filter(p=>!p.is_folded).length,1);
 const settlement=await computeVoiceFinishSettlement({handId:hand,stateVersion:snapshot.state_version,buttonSeat:snapshot.button_seat,
  communityCards:snapshot.community_cards,players,actions:snapshot.actions,bettingComplete:isBettingRoundComplete(runtime)});
 assert.equal(settlement.settlementOrigin,'engine_fold_win');assert.equal(settlement.summary.conservation_total,40000);
 const handRow=JSON.parse(sql(`SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}';`));
 const record={hand_number:handRow.hand_number,hand_time:handRow.created_at,players:settlement.recordPlayers,actions:settlement.recordActions,
  side_pots:settlement.sidePots,community_cards:snapshot.community_cards,pot_size:settlement.potSize};
 const key='native-finish-'+crypto.randomUUID(),trace='native-finish-trace';
 const cashBefore=sql(`SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}';`);
 const invoke=(traceId,{actor=f.actor,requestKey=key,digest=settlement.settlementDigest,payload=record}={})=>sql(`BEGIN;${service}SELECT public.commit_tracker_voice_finish_v0('${actor}','${f.tour}','${table.id}','${hand}',
 'openai_realtime','gpt-live-transcribe','${key}','ket thuc hand','${snapshot.state_version}','${requestKey}','${traceId}',
 '${settlement.settlementOrigin}','${digest}',${quote(payload)}::jsonb);COMMIT;`);
 const receipt=JSON.parse(invoke(trace));assert.equal(receipt.ok,true);
 const committedFingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
 'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${hand}'),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tracker_voice_events e WHERE hand_id='${hand}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'))::text);`);
 const committedBeforeReplay=committedFingerprint();
 // Fresh connection after actual COMMIT, same identity: immutable replay, no second finish.
 const replay=JSON.parse(invoke('native-finish-retry'));
 assert.deepEqual(replay,{...receipt,duplicate:true});
 assert.equal(committedFingerprint(),committedBeforeReplay);
 for(const options of [{digest:'d'.repeat(64)},{payload:{...record,pot_size:record.pot_size+1}}]){
  assert.equal(JSON.parse(invoke('native-finish-conflict',options)).error,'idempotency_mismatch');
  assert.equal(committedFingerprint(),committedBeforeReplay);
 }
 const outsider=JSON.parse(invoke('native-finish-outsider',{actor:f.player}));
 assert.equal(outsider.ok,false);assert.equal(committedFingerprint(),committedBeforeReplay);
 const canonicalRequest=await buildVoiceFinishCanonicalRequest({rawTranscript:'ket thuc hand',expectedStateVersion:snapshot.state_version,
  payload:{settlementOrigin:settlement.settlementOrigin,settlementDigest:settlement.settlementDigest}});
 const source=readFileSync(new URL('../../src/lib/trackerVoice/api.ts',import.meta.url),'utf8'),tree=parseSync(source,{syntax:'typescript'});
 const fn=tree.body.find(n=>n.type==='ExportDeclaration'&&n.declaration.identifier?.value==='commitTrackerVoiceFinish').declaration;
 const body=Buffer.from(source).subarray(fn.span.start-tree.span.start,fn.span.end-tree.span.start).toString()
  .replace('const { supabase } = await import("@/integrations/supabase/client");','const supabase = client;');
 const code=transformSync(body+'\ncommitTrackerVoiceFinish;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 let calls=0;
 for(const result of [receipt,replay]){
  const commit=runInNewContext(code,{Error,client:{functions:{invoke:async()=>{calls++;return {data:{data:result},error:null};}}}});
  assert.equal(await commit({tournamentId:f.tour,tournamentTableId:table.id,handId:hand,expectedStateVersion:snapshot.state_version,
   idempotencyKey:key,traceId:trace,canonicalRequest}),result);
 }
 assert.equal(calls,2);
 // Actual Edge case with real SQL reads: recovery must not require an active hand
 // or invoke a mutation again. Auth/HTTP transport remains modeled.
 const edgeSource=readFileSync(new URL('../../supabase/functions/tournament-live-update/index.ts',import.meta.url),'utf8');
 const edgeTree=parseSync(edgeSource,{syntax:'typescript'});let finishCase;
 function visit(node){if(!node||typeof node!=='object')return;
  if(node.type==='SwitchCase'&&node.test?.value==='commit_voice_finish')finishCase=node;
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
 visit(edgeTree);assert.ok(finishCase);
 const caseText=Buffer.from(edgeSource).subarray(finishCase.span.start-edgeTree.span.start,finishCase.span.end-edgeTree.span.start).toString();
 const branchCode=transformSync('async function retry(body){let result;const tournament_id=body.tournament_id;switch(body.action){'+caseText+'}return new Response(JSON.stringify(result),{status:200});}retry;',
  {jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code;
 let snapshotCalls=0,reads=0,mutations=0,readFailure=false,missingReceipt=false;const edgeUser={id:f.actor};
 const providerNode=edgeTree.body.find(n=>n.type==='FunctionDeclaration'&&n.identifier.value==='providerForVoiceRequest');
 const providerText=Buffer.from(edgeSource).subarray(providerNode.span.start-edgeTree.span.start,providerNode.span.end-edgeTree.span.start).toString();
 const providerForVoiceRequest=runInNewContext(transformSync(providerText+'\nproviderForVoiceRequest;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code);
 const readClient={rpc:async(name,args)=>{
    if(name==='commit_tracker_voice_finish_v0'){
     mutations++;assert.equal(args.p_actor_user_id,edgeUser.id);
     const types={p_actor_user_id:'uuid',p_tournament_id:'uuid',p_tournament_table_id:'uuid',p_hand_id:'uuid',p_provider_name:'text',p_provider_model:'text',
      p_provider_event_id:'text',p_final_transcript:'text',p_expected_state_version:'text',p_idempotency_key:'text',p_trace_id:'text',p_settlement_origin:'text',p_settlement_digest:'text',p_record_payload:'jsonb'};
     assert.deepEqual(Object.keys(args).sort(),Object.keys(types).sort());
     return {data:JSON.parse(sql(`BEGIN;${service}SELECT public.${name}(${Object.entries(args).map(([k,v])=>k+'=>'+quote(v)+'::'+types[k]).join(',')});COMMIT;`)),error:null};
    }
    assert.equal(name,'resolve_tracker_voice_finish_intent_v1');
    reads++;assert.equal(args.p_actor_user_id,edgeUser.id);
    if(readFailure)return {data:null,error:{message:'TEST_read_unavailable'}};
    if(missingReceipt)return {data:{status:'unavailable'},error:null};
    return {data:JSON.parse(sql(`BEGIN;${service}SELECT public.resolve_tracker_voice_finish_intent_v1('${args.p_actor_user_id}',${quote(args.p_intent)}::jsonb);COMMIT;`)),error:null};
 },from(name){assert.ok(['tournament_hands','hand_players','hand_actions'].includes(name));let columns,where=[],order=[];
  const query={select:value=>{assert.match(value,/^[a-z_, ]+$/);columns=value;return query;},eq:(k,v)=>{assert.match(k,/^[a-z_]+$/);where.push(k+'='+quote(v));return query;},
   order:k=>{assert.match(k,/^[a-z_]+$/);order.push(k);return query;},
   // Hosted Supabase service_role bypasses RLS; the old native fixture role does
   // not. Model that attribute ONLY inside each rolled-back read transaction.
   // Object grants still apply; never grant SELECT or alter application policies.
   async read(){try{return {data:JSON.parse(sql(`BEGIN;ALTER ROLE service_role BYPASSRLS;${service}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT ${columns} FROM public.${name} WHERE ${where.join(' AND ')}${order.length?' ORDER BY '+order.join(','):''}) x;ROLLBACK;`)),error:null};}
    catch(error){return {data:null,error:{message:String(error)}};}},
   async maybeSingle(){const r=await query.read();return {data:r.data?.[0]??null,error:r.error};},
   then(resolve,reject){return query.read().then(resolve,reject);}};return query;
 }};
 const functionText=name=>{const node=edgeTree.body.find(n=>n.type==='FunctionDeclaration'&&n.identifier.value===name);assert.ok(node);return Buffer.from(edgeSource).subarray(node.span.start-edgeTree.span.start,node.span.end-edgeTree.span.start).toString();};
 const deno={env:{get:()=> 'TEST_ONLY'}};
 const loadFinish=runInNewContext(transformSync(functionText('loadAuthoritativeVoiceFinish')+'\nloadAuthoritativeVoiceFinish;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code,
  {Error,Deno:deno,createClient:()=>readClient,reduceHand,isBettingRoundComplete,computeVoiceFinishSettlement});
 const workflow=runInNewContext(transformSync(functionText('streetForBoard')+'\n'+functionText('workflowForVoiceSnapshot')+'\nworkflowForVoiceSnapshot;',{jsc:{parser:{syntax:'typescript'},target:'es2022'}}).code,
  {reduceHand,isBettingRoundComplete,isRunout,actionWorkflowForStreet});
 const retry=runInNewContext(branchCode,{Response,Error,user:edgeUser,providerForVoiceRequest,buildVoiceFinishCanonicalRequest,voiceCanonicalRequestsMatch,
  corsHeaders:{},createClient:()=>readClient,Deno:deno,loadAuthoritativeVoiceFinish:loadFinish,workflowForVoiceSnapshot:workflow,routeTrackerVoiceIntent,
  validationError:(code,message)=>new Response(JSON.stringify({code,error:message}),{status:422}),
  supabase:{rpc:async(name,args)=>{snapshotCalls++;assert.equal(name,'get_tracker_voice_validation_snapshot');
   return {data:JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${edgeUser.id}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${edgeUser.id}"}';SET LOCAL ROLE authenticated;SELECT public.get_tracker_voice_validation_snapshot('${args.p_tournament_id}','${args.p_tournament_table_id}','${args.p_hand_id}');COMMIT;`)),error:null};}}});
 const retryBody={action:'commit_voice_finish',tournament_id:f.tour,tournament_table_id:table.id,hand_id:hand,
  final_transcript:'ket thuc hand',provider_name:'openai_realtime',provider_model:'gpt-live-transcribe',provider_event_id:key,
  expected_state_version:snapshot.state_version,idempotency_key:key,trace_id:trace,voice_request:canonicalRequest};
 const retryResponse=await retry(retryBody);assert.equal(retryResponse.status,200);
 assert.deepEqual((await retryResponse.json()).data,{...receipt,duplicate:true});assert.equal(snapshotCalls,0);assert.equal(reads,1);
 for(const patch of [{hand_id:crypto.randomUUID()},{tournament_id:crypto.randomUUID()},{tournament_table_id:crypto.randomUUID()},
  {expected_state_version:'a'.repeat(64)},{provider_event_id:'different-event'},{provider_model:'different-model'},
  {final_transcript:'different speech'},{voice_request:{...canonicalRequest,payload:{...canonicalRequest.payload,settlementDigest:'d'.repeat(64)}}},
  {voice_request:{...canonicalRequest,payload:{...canonicalRequest.payload,unexpected:'different payload'}}}]){
  const response=await retry({...retryBody,...patch});assert.equal(response.status,422);assert.equal((await response.json()).code,'IDEMPOTENCY_CONFLICT');
 }
 readFailure=true;let denied=await retry(retryBody);assert.equal(denied.status,503);readFailure=false;
 missingReceipt=true;denied=await retry(retryBody);assert.equal(denied.status,503);missingReceipt=false;
 assert.equal(snapshotCalls,0,'known or unavailable receipt must not fall through to active snapshot');
 edgeUser.id=f.player;denied=await retry(retryBody);assert.notEqual(denied.status,200);edgeUser.id=f.actor;
 denied=await retry({...retryBody,idempotency_key:'native-unknown-'+crypto.randomUUID()});assert.notEqual(denied.status,200);
 assert.equal(committedFingerprint(),committedBeforeReplay);
 console.log('NATIVE_FINISH_EDGE_COMMITTED_RECEIPT_RECOVERY_PASS');
 assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${hand}';`),'completed');
 assert.equal(sql(`SELECT count(*) FROM public.tracker_voice_events WHERE hand_id='${hand}' AND event_kind='canonical_receipt';`),'1');
 assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}';`),cashBefore);
 assert.equal(Number(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`)),40000);
 for(const expected of settlement.recordPlayers){
  assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND is_active;`)),expected.ending_stack);
  assert.equal(Number(sql(`SELECT current_stack FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND entry_no=${expected.entry_number};`)),expected.ending_stack);
 }
 console.log('NATIVE_PAID_ENGINE_FINISH_COMMIT_REPLAY_CLIENT_PASS');
 assert.equal(mutations,0,'recovery and rejection never call writer');
 // Start a genuine next hand and exercise unknown receipt -> real Edge engine -> writer.
 const nextSession=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${table.table_session_id}';`));
 const startNext=JSON.parse(sql(`BEGIN;${auth}SELECT public.start_tracker_hand_v3('${f.tour}','${table.id}','${nextSession.id}',${nextSession.control_epoch},2,now(),'${f.actor}',${players[0].seat_number});COMMIT;`));
 assert.equal(startNext.status,'success');
 const nextHand=sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${f.tour}' AND status='in_progress';`);
 assert.notEqual(nextHand,hand);
 for(const [player,type,order,amount] of [[players[0],'post_sb',1,100],[players[1],'post_bb',2,200],[players[0],'fold',3,0]]){
  const r=JSON.parse(sql(`BEGIN;${auth}SELECT public.record_action('${nextHand}','${player.player_id}','${type}',${order},${player.entry_number},'preflop',${amount});COMMIT;`));assert.equal(r.status,'success');
 }
 const nextSnapshot=JSON.parse(sql(`BEGIN;${auth}SELECT public.get_tracker_voice_validation_snapshot('${f.tour}','${table.id}','${nextHand}');COMMIT;`));
 const nextFinish=await loadFinish({tournamentId:f.tour,tournamentTableId:table.id,handId:nextHand,snapshot:nextSnapshot});
 const nextCanonical=await buildVoiceFinishCanonicalRequest({rawTranscript:'ket thuc hand',expectedStateVersion:nextSnapshot.state_version,
  payload:{settlementOrigin:nextFinish.settlement.settlementOrigin,settlementDigest:nextFinish.settlement.settlementDigest}});
 const nextBody={...retryBody,hand_id:nextHand,idempotency_key:'native-new-finish-'+crypto.randomUUID(),provider_event_id:'native-new-event-'+crypto.randomUUID(),
  expected_state_version:nextSnapshot.state_version,voice_request:nextCanonical};
 const nextResponse=await retry(nextBody),nextResult=await nextResponse.json();assert.equal(nextResponse.status,200,JSON.stringify(nextResult));assert.equal(nextResult.data.ok,true);assert.equal(mutations,1);
 assert.equal(sql(`SELECT status FROM public.tournament_hands WHERE id='${nextHand}';`),'completed');
 assert.equal(Number(sql(`SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active;`)),40000);
 for(const expected of nextFinish.settlement.recordPlayers){
  assert.equal(Number(sql(`SELECT chip_count FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND player_id='${expected.player_id}' AND is_active;`)),expected.ending_stack);
 }
 const nextReplay=await retry(nextBody);assert.equal(nextReplay.status,200);
 assert.deepEqual((await nextReplay.json()).data,{...nextResult.data,duplicate:true});assert.equal(mutations,1);
 assert.equal(sql(`SELECT count(*) FROM public.tracker_voice_events WHERE hand_id='${nextHand}' AND event_kind='canonical_receipt';`),'1');
 assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM public.cashier_buyin_movements c WHERE tournament_id='${f.tour}';`),cashBefore);
 console.log('NATIVE_FINISH_UNKNOWN_INTENT_EDGE_ENGINE_WRITER_PASS');
}finally{
 if(globalBefore==='ABSENT')sql("DELETE FROM public.app_settings WHERE key='tracker_voice_global_enabled';");
 else sql(`UPDATE public.app_settings SET value=${quote(globalBefore)}::jsonb WHERE key='tracker_voice_global_enabled';`);
 assert.equal(sql("SELECT coalesce((SELECT value::text FROM public.app_settings WHERE key='tracker_voice_global_enabled'),'ABSENT');"),globalBefore);
 assert.equal(sql("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';"),serviceBypassBefore);
}
