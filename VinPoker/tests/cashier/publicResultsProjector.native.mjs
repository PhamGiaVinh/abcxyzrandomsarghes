import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {reducePublicSpectatorPayload} from '../../supabase/functions/_shared/publicSpectatorReducer.ts';
import {mainEventBrowser} from './mainEventBrowser.fixture.mjs';

// Execute the product handler and SQL contracts, not a mocked publication.
// Non-target jobs are only locked transactionally, never deleted/rescheduled.
export async function runPublicResultsProjector(sql,session,until,{configuredSingle=false,mainEvent=false,linkedTerminal216=false}={}) {
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.ok(Number(configuredSingle)+Number(mainEvent)+Number(linkedTerminal216)<=1);
 const tours=linkedTerminal216?['4cd3af4d-7e1d-4042-855f-04fb6777e580']:mainEvent?[mainEventBrowser.final]:configuredSingle?['829e61fe-0ac8-4ced-950d-ab76cb8dadc5']:['5875d8a8-b55f-4dbf-b462-46404d3ae04e','664e6861-ec0b-4471-8902-672be2d30efe'];
 const financialFingerprint=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(f) ORDER BY event_id) FROM public.multi_day_payout_finalizations_v1 f),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e)
 )::text);`);
 const financialBefore=linkedTerminal216?financialFingerprint():null;
 if(linkedTerminal216){
  assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
  assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.tournament_close_report r ON r.tournament_id=t.id
   JOIN public.multi_day_payout_finalizations_v1 p ON p.final_tournament_id=t.id
   WHERE t.id='${tours[0]}' AND t.event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
    AND t.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND t.status='completed'
    AND r.id='36e704e3-6510-4fc1-94df-fd0c262efb0c' AND r.detail->'official_results'->>'field'='15'
    AND p.request_id='264bdd6e-33a7-4d7b-837a-e3a6b60a16a6' AND p.unpaid_obligation_vnd=2500000 AND p.paid_player_vnd=0;`),'1');
 }
 if(mainEvent){
  assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
  assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.tournament_close_report r ON r.tournament_id=t.id
   JOIN public.multi_day_payout_finalizations_v1 p ON p.final_tournament_id=t.id
   WHERE t.id='${mainEventBrowser.final}' AND t.event_id='${mainEventBrowser.event}' AND t.club_id='${mainEventBrowser.club}'
    AND t.status='completed' AND r.detail->'official_results'->>'field'='8';`),'1');
 }
 if(configuredSingle){
  assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
  assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.tournament_close_report r ON r.tournament_id=t.id
   WHERE t.id='${tours[0]}' AND t.club_id='349ecf35-50ba-4c71-a581-15dc45f1cd01' AND t.name='Single-day browser local TEST'
    AND t.status='completed' AND r.id='1211ba1e-f2f6-4a9f-8400-2211084805cb'
    AND r.detail->'official_results'->>'field'='8';`),'1');
 }
 const quoted=tours.map(t=>`'${t}'`).join(',');
 // Native PostgreSQL has no hosted Realtime transport. Capture its outbound
 // notification only; do not replace projection reads, writes or freshness.
 assert.equal(sql("SELECT to_regnamespace('realtime') IS NULL;"),'t');
 sql(`CREATE SCHEMA realtime;
  CREATE TABLE realtime.native_public_result_notifications(payload jsonb,event text,topic text,private boolean);
  CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO realtime.native_public_result_notifications VALUES(payload,event,topic,private) $$;
  GRANT USAGE ON SCHEMA realtime TO service_role;GRANT EXECUTE ON FUNCTION realtime.send(jsonb,text,text,boolean) TO service_role;`);
 const lock=session('public_results_local_scope');
 lock.child.stdin.write(`BEGIN;SELECT 1 FROM spectator_projection_v2.work_groups
  WHERE NOT(tournament_id IN(${quoted}) AND component='payout') FOR UPDATE;
  SELECT 'PUBLIC_RESULTS_SCOPE_LOCKED';\n`);
 await until(()=>lock.output().includes('PUBLIC_RESULTS_SCOPE_LOCKED'));
 const calls=[];
 const signatures={
  claim_public_spectator_projection_v2:['p_limit'],
  get_public_spectator_projection_source_v2:['p_tournament_id','p_component','p_fencing_token'],
  publish_public_spectator_projection_v2:['p_tournament_id','p_component','p_group_key','p_fencing_token','p_source_vector','p_payload'],
  fail_public_spectator_projection_v2:['p_tournament_id','p_component','p_group_key','p_fencing_token','p_error'],
 };
 const literal=v=>v===null?'NULL':typeof v==='number'?String(v):`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
 const admin={rpc(name,args){
  assert.ok(signatures[name],`unexpected RPC ${name}`);
  if(args.p_tournament_id)assert.ok(tours.includes(args.p_tournament_id)&&args.p_component==='payout');
  return {async abortSignal(signal){
   signal.throwIfAborted();calls.push(name);
   try{return {data:JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='4000ms';
    SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
    SELECT to_jsonb(public.${name}(${signatures[name].map(k=>literal(args[k])).join(',')}));COMMIT;`)),error:null};}
   catch(error){return {data:null,error:{message:error.message}};}
  }};
 }};
 let handler;
 const source=readFileSync('supabase/functions/public-spectator-projector-v2/index.ts','utf8')
  .replace(/^import .*\r?\n/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>admin,reducePublicSpectatorPayload,Response,AbortController,setTimeout,clearTimeout,
  Deno:{env:{get:key=>({PUBLIC_SPECTATOR_WORKER_SECRET:'LOCAL_ONLY',SUPABASE_URL:'http://127.0.0.1',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_ONLY'})[key]},serve:fn=>{handler=fn;}},
 });
 try{
  assert.equal((await handler(new Request('http://127.0.0.1',{method:'POST'}))).status,401);
  const response=await handler(new Request('http://127.0.0.1',{method:'POST',headers:{authorization:'Bearer LOCAL_ONLY'}}));
  const result=await response.json();console.log('ACTUAL_PUBLIC_PROJECTOR',JSON.stringify(result));
  assert.equal(response.status,200);assert.equal(result.processed,result.claimed);
  assert.ok(result.results.every(r=>r.published),'every scoped pending job must publish');
  for(const tour of tours){
   const rows=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
    SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.get_public_tournament_results('${tour}') t;COMMIT;`));
   console.log('ACTUAL_ANON_OFFICIAL_RESULTS',JSON.stringify({tour,rows}));
   assert.ok(rows.length>0&&rows.every(r=>r.result_status==='official'&&r.player_name?.trim()));
   if(configuredSingle){
    assert.deepEqual(rows.map(r=>({place:r.place,prize:Number(r.prize),name:r.player_name})),[
     {place:1,prize:450000,name:'Single-day 829e61fe TEST 6'},
     {place:2,prize:225000,name:'PLAYER'},{place:3,prize:225000,name:'Single-day 829e61fe TEST 5'}]);
    for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['place','prize','avatar_url','awarded_at','player_name','result_status'].sort(),
     'anonymous publication must not expose payment receipts or private identities');
   }
   if(mainEvent){
    assert.deepEqual(rows.map(r=>({place:r.place,prize:Number(r.prize)})),[1,2,3,4].map(place=>({place,prize:100000})));
    for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['place','prize','avatar_url','awarded_at','player_name','result_status'].sort());
   }
   if(linkedTerminal216){
    assert.deepEqual(rows.map(r=>({place:r.place,prize:Number(r.prize)})),[
     {place:1,prize:570000},{place:2,prize:300000},{place:3,prize:200000},{place:4,prize:110000}]);
    for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['place','prize','avatar_url','awarded_at','player_name','result_status'].sort());
   }
   assert.equal(rows.length,linkedTerminal216||mainEvent?4:configuredSingle?3:tour===tours[0]?3:4);
   assert.equal(rows.reduce((sum,r)=>sum+Number(r.prize),0),linkedTerminal216?1180000:configuredSingle?900000:400000,
    'public rank prize is not the private D2 bag/min-cash obligation total');
   assert.throws(()=>sql(`BEGIN;UPDATE spectator_projection_v2.entity_markers SET source_revision=source_revision+1
    WHERE tournament_id='${tour}' AND component='payout';
    SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
    SELECT * FROM public.get_public_tournament_results('${tour}');ROLLBACK;`),/public_payout_pending/,
    'a newer source marker must immediately invalidate the old public proof');
  }
  assert.equal(Number(sql(`SELECT count(*) FROM realtime.native_public_result_notifications WHERE event='changed' AND private=false;`)),result.results.filter(r=>r.published).length);
  console.log('PUBLIC_RESULTS_PROJECTOR_NATIVE_ACCEPTED',JSON.stringify({calls,realtime:'local notification sink, not hosted delivery'}));
 }finally{
  lock.child.stdin.end('ROLLBACK;\n');await lock.closed;
  sql(`DROP FUNCTION realtime.send(jsonb,text,text,boolean);DROP TABLE realtime.native_public_result_notifications;DROP SCHEMA realtime;`);
  if(linkedTerminal216)assert.equal(financialFingerprint(),financialBefore,'publication must not change frozen obligations, payments, entries or cash');
 }
}
