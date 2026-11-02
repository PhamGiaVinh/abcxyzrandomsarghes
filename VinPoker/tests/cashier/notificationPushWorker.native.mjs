import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {constantTimeEqual,isUuid,parsePushPayload,authorizeInternalTrigger,getIdempotencyKey} from '../../supabase/functions/_shared/internal-trigger-auth.ts';

// Parent owns exact isolated PG17/no-pg_net guard and server lifecycle.
export async function runPushWorkerNative(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const ids=[randomUUID(),randomUUID()],tag='push_worker_'+randomUUID();
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n),
  'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM private.notification_push_outbox_v1 q),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m))::text);`);
 const before=fingerprint();
 const service=query=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;${query};COMMIT;`));
 let rpcCalls=0,providerAttempts=0,providerResponseLoss=true,finishResponseLoss=false,enabled=true;
 const providerReceipts=new Map(),sentKeys=[];
 const rpc=async(name,args)=>{
  rpcCalls++;
  if(name==='claim_notification_push_v1'){
   assert.ok(ids.includes(args.p_notification_id),'no unscoped access to retained jobs');
   return {data:service(`SELECT public.claim_notification_push_v1(${quote(args.p_notification_id)})`),error:null};
  }
  assert.equal(name,'finish_notification_push_v1');
  assert.ok(isUuid(args.p_id)&&isUuid(args.p_token));assert.ok(['provider_accepted','not_created','needs_attention'].includes(args.p_outcome));
  assert.ok(args.p_provider_id===null||isUuid(args.p_provider_id));
  const result=service(`SELECT to_jsonb(public.finish_notification_push_v1(${quote(args.p_id)},${quote(args.p_token)},${quote(args.p_outcome)},${args.p_provider_id?quote(args.p_provider_id):'NULL'}))`);
  if(finishResponseLoss){finishResponseLoss=false;throw Error('LOCAL_FINISH_RESPONSE_LOSS_AFTER_COMMIT');}
  return {data:result,error:null};
 };
 const env={SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_SERVICE',DEALER_TRIGGER_INTERNAL_SECRET:'LOCAL_INTERNAL',ONESIGNAL_APP_ID:'LOCAL_APP',ONESIGNAL_REST_API_KEY:'LOCAL_PROVIDER'};
 const load=(file,extra)=>{
  let handler;
  const source=readFileSync(file,'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   Request,Response,URL,AbortSignal,Date,constantTimeEqual,isUuid,parsePushPayload,getIdempotencyKey,
   authorizeInternalTrigger:req=>authorizeInternalTrigger(req,'LOCAL_INTERNAL'),
   Deno:{env:{get:name=>name==='NOTIFICATION_PUSH_WORKER_ENABLED'?(enabled?'true':'false'):env[name]},serve:fn=>{handler=fn;}},...extra,
  });return handler;
 };
 const send=load('supabase/functions/send-push-notification/index.ts',{
  fetch:async(url,options)=>{
   assert.equal(url,'https://api.onesignal.com/notifications?c=push');
   const payload=JSON.parse(options.body);assert.ok(isUuid(payload.idempotency_key));
   assert.equal(options.headers.Authorization,'Key LOCAL_PROVIDER');
   providerAttempts++;sentKeys.push(payload.idempotency_key);
   if(!providerReceipts.has(payload.idempotency_key))providerReceipts.set(payload.idempotency_key,randomUUID());
   if(providerResponseLoss){providerResponseLoss=false;throw Error('LOCAL_RESPONSE_LOSS_AFTER_PROVIDER_ACCEPTANCE');}
   return new Response(JSON.stringify({id:providerReceipts.get(payload.idempotency_key),recipients:1}));
  },
 });
 const worker=load('supabase/functions/notification-push-worker/index.ts',{
  createClient:(url,key)=>{assert.equal(url,env.SUPABASE_URL);assert.equal(key,env.SUPABASE_SERVICE_ROLE_KEY);return {rpc};},
  fetch:async(url,options)=>{assert.equal(url,'http://local.invalid/functions/v1/send-push-notification');return send(new Request(url,options));},
 });
 const invoke=async(id,bearer='LOCAL_SERVICE')=>{
  const response=await worker(new Request('http://local.invalid/worker',{method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({notification_id:id})}));
  return {status:response.status,body:await response.json()};
 };
 const row=id=>JSON.parse(sql(`SELECT to_jsonb(q) FROM private.notification_push_outbox_v1 q WHERE notification_id=${quote(id)};`));
 try{
  sql(`INSERT INTO public.notifications(id,user_id,type,title,body,data) VALUES ${ids.map(id=>`(${quote(id)},'675fe35e-60a8-4452-bb90-e79486d54da6','registration_confirmed','LOCAL push worker TEST',${quote(tag)},'{}')`).join(',')};`);
  assert.equal((await invoke(ids[0],'USER_TOKEN')).status,401);assert.equal(rpcCalls,0);assert.equal(providerAttempts,0);
  enabled=false;assert.equal((await invoke(ids[0])).status,404);assert.equal(rpcCalls,0);enabled=true;
  const lost=await invoke(ids[0]);assert.equal(lost.status,503);assert.equal(lost.body.ok,false);
  const first=row(ids[0]);assert.equal(first.state,'processing');assert.equal(first.attempts,1);assert.equal(providerReceipts.size,1);
  const busy=await invoke(ids[0]);assert.equal(busy.body.status,'no_claimable_jobs');assert.equal(providerAttempts,1);
  // Exact owned TEST job only: simulate expiry, not wall-clock elapsed evidence.
  sql(`UPDATE private.notification_push_outbox_v1 SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${quote(first.id)} AND notification_id=${quote(ids[0])};`);
  const retried=await invoke(ids[0]);assert.equal(retried.status,200);assert.equal(retried.body.provider_accepted,1);
  const second=row(ids[0]);assert.equal(second.state,'provider_accepted');assert.equal(second.id,first.id);
  assert.notEqual(second.lease_token,first.lease_token);assert.equal(second.attempts,2);
  assert.deepEqual(sentKeys,[first.id,first.id]);assert.equal(providerReceipts.size,1);
  assert.equal(service(`SELECT to_jsonb(public.finish_notification_push_v1(${quote(first.id)},${quote(first.lease_token)},'provider_accepted',${quote(second.provider_id)}))`),false);
  assert.equal((await invoke(ids[0])).body.status,'no_claimable_jobs');assert.equal(providerAttempts,2);
  console.log('PUSH_ACTUAL_WORKER_SEND_HANDLER_REAL_PG_RESPONSE_LOSS_RECLAIM_STABLE_KEY_STALE_FINISH_PASS');
  finishResponseLoss=true;
  const finishLost=await invoke(ids[1]);assert.equal(finishLost.status,503);assert.equal(finishLost.body.ok,false);
  assert.equal(row(ids[1]).state,'provider_accepted');assert.equal(providerAttempts,3);
  assert.equal((await invoke(ids[1])).body.status,'no_claimable_jobs');assert.equal(providerAttempts,3);assert.equal(providerReceipts.size,2);
  console.log('PUSH_REAL_PG_FINISH_COMMIT_RESPONSE_LOSS_NO_PROVIDER_REPLAY_PASS');
 }finally{
  sql(`DELETE FROM public.notifications WHERE id IN(${ids.map(quote).join(',')}) AND body=${quote(tag)} AND title='LOCAL push worker TEST';`);
  assert.equal(fingerprint(),before,'worker probe changed retained notification/queue/cash');
  console.log('PUSH_WORKER_RETAINED_NOTIFICATION_QUEUE_CASH_UNCHANGED');
 }
}
