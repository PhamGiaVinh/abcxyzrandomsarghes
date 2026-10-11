import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.test('history worker rejects unknown claims and reports lease-loss honestly through actual handler',async()=>{
 const oldServe=Deno.serve, oldFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TRACKER_HISTORY_COMPLETION_WORKER_ENABLED',
  'TRACKER_HISTORY_CANARY_INTERNAL_SECRET','TRACKER_HISTORY_CANARY_ALLOWED_HAND_IDS'];
 const previous=names.map(name=>Deno.env.get(name));
 let handler: (req: Request)=>Promise<Response>;
 Object.defineProperty(Deno,'serve',{configurable:true,value:(fn: typeof handler)=>{handler=fn;}});
 Deno.env.set(names[0],'https://backend.invalid'); Deno.env.set(names[1],'history-service-fixture');
 Deno.env.set(names[2],'true');
 const hand='00000000-0000-4000-8000-000000000001',lease='00000000-0000-4000-8000-000000000002';
 const snapshot={hand:{id:hand,tournament_id:'00000000-0000-4000-8000-000000000003',hand_number:1,
  table_id:'00000000-0000-4000-8000-000000000004',button_seat:2,community_cards:['2c','3d','4h','5s','9c'],
  pot_size:15,side_pots:[],status:'completed',is_voided:false,source_revision:1,
  tracker_level_id:'level-test',tracker_level_number:1,tracker_small_blind:1,tracker_big_blind:2,tracker_bba:0,tracker_is_break:false},
  players:[
   {hand_id:hand,player_id:'button',entry_number:1,seat_number:2,starting_stack:100,ending_stack:102,hole_cards:['As','Kd'],is_eliminated:false},
   {hand_id:hand,player_id:'left',entry_number:1,seat_number:3,starting_stack:100,ending_stack:103,hole_cards:['Ah','Jd'],is_eliminated:false},
   {hand_id:hand,player_id:'loser',entry_number:1,seat_number:4,starting_stack:100,ending_stack:95,hole_cards:['Qs','Qc'],is_eliminated:false}],
  actions:['button','left','loser'].map((player,i)=>({id:`action-${i}`,hand_id:hand,player_id:player,entry_number:1,street:'preflop',action_type:'all_in',action_amount:5,action_order:i+1})),
  sourceRevision:1,sourceChainHash:'a'.repeat(64)};
 const call=(extra: Record<string,unknown>={})=>handler!(new Request('https://worker.invalid',{method:'POST',headers:{authorization:'Bearer history-service-fixture'},body:JSON.stringify({limit:1,...extra})}));
 try {
  await import('./index.ts');
  globalThis.fetch=()=>{throw new Error('invalid hand scope reached backend');};
  Deno.env.set(names[2],'false'); Deno.env.set(names[3],'canary-fixture'); Deno.env.set(names[4],JSON.stringify([hand]));
  const canaryCall=(body: unknown)=>handler!(new Request('https://worker.invalid',{method:'POST',
   headers:{authorization:'Bearer canary-fixture'},body:JSON.stringify(body)}));
  const darkService=await call(); assertEquals(darkService.status,404); await darkService.json();
  const unscoped=await canaryCall({}); assertEquals(unscoped.status,400); assertEquals((await unscoped.json()).code,'hand_scope_required');
  const outside=await canaryCall({hand_ids:[lease]}); assertEquals(outside.status,400); assertEquals((await outside.json()).code,'hand_out_of_scope');
  Deno.env.delete(names[4]);
  const missing=await canaryCall({hand_ids:[hand]}); assertEquals(missing.status,400); assertEquals((await missing.json()).code,'canary_scope_unavailable');
  Deno.env.set(names[4],JSON.stringify([hand]));
  globalThis.fetch=(input)=>{
   const url=new URL(input instanceof Request?input.url:String(input));
   assertEquals(url.pathname.endsWith('/claim_tracker_historical_display_jobs_scoped_v1'),true);
   return Promise.resolve(new Response('[]',{status:200,headers:{'content-type':'application/json'}}));
  };
  const bounded=await canaryCall({hand_ids:[hand],limit:1}); assertEquals(bounded.status,200); await bounded.json();
  Deno.env.set(names[2],'true'); Deno.env.delete(names[3]); Deno.env.delete(names[4]);
  globalThis.fetch=()=>{throw new Error('invalid hand scope reached backend');};
  for(const body of ['{"hand_ids":[','[]','123','null']) {
   const response=await handler!(new Request('https://worker.invalid',{method:'POST',headers:{authorization:'Bearer history-service-fixture'},body}));
   assertEquals(response.status,400); await response.json();
  }
  for(const scope of [[],null,['bad'],[hand,hand]]) {
   const response=await call({hand_ids:scope}); assertEquals(response.status,400); await response.json();
  }
  for(const scenario of ['empty','null','object','bad_revision','bad_lease','finish_lost','needs_attention','valid_commit','empty_commit','rejected_commit','scoped_commit','outside_scope']) {
   let finishCalls=0;
   globalThis.fetch=(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input)); assertEquals(url.origin,'https://backend.invalid');
    const route=url.pathname.split('/').at(-1);
    let data: unknown;
    if(route==='claim_tracker_historical_display_jobs'||route==='claim_tracker_historical_display_jobs_scoped_v1') {
     if(route.endsWith('scoped_v1')) assertEquals(JSON.parse(String((init as {body?:unknown})?.body)).p_hand_ids,[hand]);
     data=scenario==='empty'?[]:scenario==='null'?null:scenario==='object'?{}:
      [{hand_id:scenario==='outside_scope'?lease:hand,source_revision:scenario==='bad_revision'?0:1,lease_token:scenario==='bad_lease'?'invalid':lease}];
    }
    else if(route==='get_tracker_historical_display_snapshot') data=scenario.includes('commit')?snapshot:{};
    else if(route==='tournament_settlement_outcomes') data=[];
    else if(route==='finish_tracker_historical_display_job') {finishCalls++; data=scenario!=='finish_lost';}
    else if(route==='commit_tracker_historical_display_outcome_v2') {
     const args=JSON.parse(String((init as {body?: unknown}|undefined)?.body));
     assertEquals(args.p_lease_token,lease); assertEquals(args.p_expected_source_revision,1);
     data=scenario==='empty_commit'?null:{ok:['valid_commit','scoped_commit'].includes(scenario),settlement_revision:1,outcome_hash:args.p_outcome_hash};
    }
    else throw new Error(`unexpected backend route ${route}`);
    return Promise.resolve(new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}}));
   };
   const response=await call(['scoped_commit','outside_scope'].includes(scenario)?{hand_ids:[hand]}:{}); const body=await response.json();
   assertEquals(response.status,['empty','needs_attention','valid_commit','empty_commit','rejected_commit','scoped_commit'].includes(scenario)?200:503,scenario);
   assertEquals(body.completed??0,['valid_commit','scoped_commit'].includes(scenario)?1:0,scenario);
   assertEquals(finishCalls,['needs_attention','finish_lost','empty_commit','rejected_commit'].includes(scenario)?1:0,scenario);
   if(['empty_commit','rejected_commit'].includes(scenario)) assertEquals(body.retried,1);
   if(scenario==='finish_lost') {assertEquals(body.ok,false);assertEquals(body.unresolved,1);}
   if(scenario==='needs_attention') assertEquals(body.needs_attention,1);
  }
  // Model the DB's already-qualified atomic completion contract at the HTTP seam.
  // This is not a PostgreSQL or deployed Edge integration test.
  let committed=false, commitCalls=0, lostFinishCalls=0;
  globalThis.fetch=(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input));
   assertEquals(url.origin,'https://backend.invalid');
   const route=url.pathname.split('/').at(-1);
   let data: unknown;
   if(route==='claim_tracker_historical_display_jobs_scoped_v1') {
    const args=JSON.parse(String((init as {body?: unknown}|undefined)?.body));
    assertEquals(args.p_hand_ids,[hand]);
    data=committed?[]:[{hand_id:hand,source_revision:1,lease_token:lease}];
   } else if(route==='get_tracker_historical_display_snapshot') data=snapshot;
   else if(route==='tournament_settlement_outcomes') data=[];
   else if(route==='commit_tracker_historical_display_outcome_v2') {
    commitCalls++;
    const args=JSON.parse(String((init as {body?: unknown}|undefined)?.body));
    assertEquals(args.p_hand_id,hand); assertEquals(args.p_lease_token,lease);
    assertEquals(args.p_expected_source_revision,1);
    committed=true;
    return Promise.reject(new TypeError('fixture_response_lost_after_commit'));
   } else if(route==='finish_tracker_historical_display_job') {
    lostFinishCalls++;
    assertEquals(committed,true);
    data=false; // Completed queue has no live lease for this catch-path finish.
   } else throw new Error(`unexpected recovery route ${route}`);
   return Promise.resolve(new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}}));
  };
  const lost=await call({hand_ids:[hand]});
  assertEquals(lost.status,503);
  const lostBody=await lost.json();
  assertEquals(lostBody.ok,false); assertEquals(lostBody.completed,0);
  assertEquals(lostBody.unresolved,1); assertEquals(lostBody.retried,0);
  const recovered=await call({hand_ids:[hand]});
  assertEquals(recovered.status,200);
  assertEquals(await recovered.json(),{ok:true,claimed:0,completed:0,retried:0,needs_attention:0,unresolved:0});
  assertEquals(commitCalls,1); assertEquals(lostFinishCalls,1);
 } finally {
  globalThis.fetch=oldFetch; Object.defineProperty(Deno,'serve',{configurable:true,value:oldServe});
  names.forEach((name,i)=>previous[i]===undefined?Deno.env.delete(name):Deno.env.set(name,previous[i]!));
 }
});
