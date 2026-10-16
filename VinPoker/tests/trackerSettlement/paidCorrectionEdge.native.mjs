import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {computeAuthoritativeSettlement,normalizeSettlementSourceRpcResult} from '../../supabase/functions/_shared/trackerSettlement/compute.ts';
import {assertExpectedTargetEndingStacks,redactedTargetEndingStacks} from '../../supabase/functions/_shared/trackerSettlement/expectedEndingStacks.ts';
import {canonicalJsonV1} from '../../supabase/functions/_shared/trackerSettlement/outcomeV1.ts';

// Called only after paidHistoryWorker's dedicated local database guard/fixture.
// Real Edge code, compute and SQL; getUser/HTTP/CORS transport is modeled.
export async function runPaidCorrectionEdge({sql,service,fixture,hand}){
 const quote=value=>value===null?'NULL':`'${(typeof value==='object'?JSON.stringify(value):String(value)).replaceAll("'","''")}'`;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${hand}'),
  'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${hand}'),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY source_revision) FROM public.tracker_historical_display_queue q WHERE hand_id='${hand}'))::text);`);
 let actor=fixture.actor,serviceReads=0,authFailure=false,authorizationFailure=false;const errors=[];
 const rpcTypes={get_tournament_settlement_source_hash:['uuid'],commit_tracker_hand_correction_outcome:['uuid','uuid','bigint','text','bigint','text','text','text','jsonb','jsonb','jsonb','jsonb','text']};
 const client={rpc:async(name,args)=>{try{
  assert.ok(rpcTypes[name],name);serviceReads++;
  const values=Object.values(args);assert.equal(values.length,rpcTypes[name].length);
  const params=Object.entries(args).map(([key,value],i)=>`${key}=>${quote(value)}::${rpcTypes[name][i]}`).join(',');
  return {data:JSON.parse(sql(service+`SELECT to_jsonb(public.${name}(${params}));`)),error:null};
 }catch(error){errors.push(String(error));return {data:null,error:{message:String(error)}};}},
 from(table){assert.ok(['tournament_hands','hand_players','hand_actions','tournament_chip_counts','tournament_settlement_outcomes'].includes(table));
  let columns,where=[],order=[],limit;const column=value=>{assert.match(value,/^[a-z_]+$/);return value;};
  const query={select:value=>{assert.match(value,/^[a-z_,]+$/);columns=value;return query;},
   eq:(key,value)=>{where.push(`${column(key)}=${quote(value)}`);return query;},
   in:(key,values)=>{assert.ok(values.length>0);where.push(`${column(key)} IN (${values.map(quote).join(',')})`);return query;},
   order:(key,options)=>{order.push(column(key)+(options?.ascending===false?' DESC':' ASC'));return query;},
   limit:value=>{assert.equal(value,1);limit=value;return query;},
   then(resolve,reject){serviceReads++;try{
    const data=JSON.parse(sql(service+`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (SELECT ${columns} FROM public.${table}${where.length?' WHERE '+where.join(' AND '):''}${order.length?' ORDER BY '+order.join(','):''}${limit?' LIMIT '+limit:''}) x;`));
    return Promise.resolve({data,error:null}).then(resolve,reject);
   }catch(error){errors.push(String(error));return Promise.resolve({data:null,error:{message:String(error)}}).then(resolve,reject);}}
  };return query;
 }};
 const user={auth:{getUser:async()=>{
  if(authFailure==='throw')throw new Error('TEST network unavailable');
  return authFailure?{data:{user:null},error:{status:authFailure==='invalid'?401:503,message:'TEST auth failure'}}:{data:{user:{id:actor}},error:null};
 }},rpc:async(name,args)=>{
  assert.equal(name,'authorize_tracker_completed_hand_correction_uat_v1');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_tournament_id:fixture.tour,p_hand_id:hand});
  if(authorizationFailure==='throw')throw new Error('TEST authority network unavailable');
  if(authorizationFailure==='malformed')return {data:{},error:null};
  if(authorizationFailure)return {data:null,error:{message:'TEST authority unavailable'}};
  return {data:JSON.parse(sql(`SET request.jwt.claim.sub='${actor}';SET request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET ROLE authenticated;SELECT public.${name}('${fixture.tour}','${hand}');`)),error:null};
 }};
 const file=readFileSync(new URL('../../supabase/functions/tournament-live-resettle-commit/index.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('index.ts',file,ts.ScriptTarget.ES2022,true);
 const stripped=ts.factory.updateSourceFile(ast,ast.statements.filter(n=>!ts.isImportDeclaration(n)));
 const code=ts.transpileModule(ts.createPrinter().printFile(stripped),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 let handler;
 runInNewContext(code,{Request,Response,Error,TextEncoder,crypto:globalThis.crypto,console,computeAuthoritativeSettlement,normalizeSettlementSourceRpcResult,
  assertExpectedTargetEndingStacks,redactedTargetEndingStacks,canonicalJsonV1,handleOptions:()=>null,
  jsonResp:(_req,value,status=200)=>new Response(JSON.stringify(value),{status}),
  createClient:(_url,key)=>key==='TEST_ANON'?user:client,
  Deno:{serve:fn=>handler=fn,env:{get:key=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'TEST_ANON',SUPABASE_SERVICE_ROLE_KEY:'TEST_SERVICE'})[key]}}});
 const players=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'ending_stack',ending_stack)) FROM public.hand_players WHERE hand_id='${hand}';`));
 const body={mode:'preview',tournament_id:fixture.tour,hand_id:hand,correction_reason:'TEST correct persisted board',edit:{communityCards:['2c','3d','4h']},expected_target_ending_stacks:players};
 const invoke=payload=>handler(new Request('https://test.invalid/correction',{method:'POST',headers:{Authorization:'Bearer TEST_USER','Content-Type':'application/json'},body:JSON.stringify(payload)}));
 const before=fingerprint();
 authFailure=true;let response=await invoke(body);assert.equal(response.status,503,'auth infrastructure failure is not invalid login');assert.equal((await response.json()).code,'authentication_unavailable');
 authFailure='throw';response=await invoke(body);assert.equal(response.status,503);assert.equal((await response.json()).code,'authentication_unavailable');
 authFailure='invalid';response=await invoke(body);assert.equal(response.status,401);assert.equal((await response.json()).code,'unauthorized');
 authFailure=false;authorizationFailure=true;response=await invoke(body);assert.equal(response.status,503,'authority RPC failure is not missing permission');assert.equal((await response.json()).code,'authorization_unavailable');
 for(const failure of ['throw','malformed']){authorizationFailure=failure;response=await invoke(body);assert.equal(response.status,503);assert.equal((await response.json()).code,'authorization_unavailable');}
 authorizationFailure=false;assert.equal(serviceReads,0);assert.equal(fingerprint(),before);
 response=await invoke(body);assert.equal(response.status,403);assert.equal((await response.json()).code,'uat_capability_disabled');assert.equal(serviceReads,0);assert.equal(fingerprint(),before);
 const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
 sql(`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled) VALUES('${fixture.club}','${fixture.tour}','${logical}','${fixture.actor}','correct_completed_hand',true);`);
 actor=crypto.randomUUID();response=await invoke(body);assert.equal(response.status,403);assert.equal((await response.json()).code,'actor_not_authorized');assert.equal(serviceReads,0);assert.equal(fingerprint(),before);
 actor=fixture.actor;response=await invoke(body);const preview=await response.json();assert.equal(response.status,200,JSON.stringify({preview,errors}));assert.equal(preview.status,'preview');assert.equal(fingerprint(),before);assert.deepEqual(errors,[]);
 const commit={...body,mode:'commit',idempotency_key:'native-correction-edge-'+hand,expected_source_revision:preview.source_revision,expected_source_chain_hash:preview.source_chain_hash,expected_outcome_hash:preview.outcome_hash};
 response=await invoke(commit);const receipt=await response.json();assert.equal(response.status,200,JSON.stringify({receipt,errors}));assert.equal(receipt.status,'verified');assert.equal(receipt.receipt.ok,true);assert.deepEqual(errors,[]);
 assert.ok(Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`))>preview.source_revision);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND correction_reason='TEST correct persisted board';`),'1');
 const after=fingerprint();response=await invoke(commit);assert.equal(response.status,409);assert.equal((await response.json()).code,'stale_correction_preview');assert.equal(fingerprint(),after);
 console.log('ACTUAL_PAID_CORRECTION_EDGE_SCOPE_PREVIEW_COMMIT_STALE_RETRY_PASS');
}
