import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {authorizeInternalTrigger,getIdempotencyKey,parsePushPayload,isUuid} from '../../supabase/functions/_shared/internal-trigger-auth';

const id='22222222-2222-4222-8222-222222222222';
const jobKey='33333333-3333-4333-8333-333333333333';
async function run({body:providerBody={id,recipients:1},status=200,secret='LOCAL_INTERNAL',configured=true,key=jobKey,throws=false,provider}:
 {body?:unknown;status?:number;secret?:string;configured?:boolean;key?:string;throws?:boolean;provider?:(url:string,options:RequestInit)=>Promise<Response>}={}){
 let handler!:(request:Request)=>Promise<Response>;
 const fetch=vi.fn(async(url:string,options:RequestInit)=>{if(provider)return provider(url,options);if(throws)throw new Error('SYNTHETIC_PRIVATE_PROVIDER_DETAIL');return new Response(JSON.stringify(providerBody),{status});});
 const source=readFileSync('supabase/functions/send-push-notification/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  authorizeInternalTrigger:(request:Request)=>authorizeInternalTrigger(request,configured?'LOCAL_INTERNAL':''),
  getIdempotencyKey,parsePushPayload,isUuid,Request,Response,fetch,
  Deno:{env:{get:(name:string)=>({ONESIGNAL_APP_ID:'LOCAL_APP',ONESIGNAL_REST_API_KEY:'LOCAL_PROVIDER'})[name]},serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/send-push',{method:'POST',headers:{'content-type':'application/json','x-vinpoker-internal-secret':secret,'x-idempotency-key':key},
  body:JSON.stringify({user_id:'11111111-1111-4111-8111-111111111111',heading:'TEST',message:'LOCAL TEST ONLY',url:'/tournaments'})}));
 return {status:response.status,body:await response.json(),fetch};
}
describe('actual push handler acknowledgement boundary (provider mocked)',()=>{
 it('passes the exact durable UUID job key through the documented provider contract',async()=>{
  const result=await run();const [url,options]=result.fetch.mock.calls[0];
  expect(url).toBe('https://api.onesignal.com/notifications?c=push');
  expect((options.headers as Record<string,string>).Authorization).toBe('Key LOCAL_PROVIDER');
  const sent=JSON.parse(options.body as string);
  expect(sent.idempotency_key).toBe(jobKey);expect(sent.target_channel).toBe('push');
  expect(sent.include_aliases).toEqual({external_id:['11111111-1111-4111-8111-111111111111']});
 });
 it('reuses the provider identity after acceptance followed by response loss (modeled provider)',async()=>{
  const receipts=new Map<string,string>();let attempts=0;
  const provider=async(_url:string,options:RequestInit)=>{
   const payload=JSON.parse(options.body as string);attempts++;
   expect(payload.idempotency_key).toBe(jobKey);
   if(!receipts.has(payload.idempotency_key))receipts.set(payload.idempotency_key,id);
   if(attempts===1)throw new Error('SYNTHETIC_RESPONSE_LOSS_AFTER_ACCEPTANCE');
   return new Response(JSON.stringify({id:receipts.get(payload.idempotency_key),recipients:1}));
  };
  const unknown=await run({provider});expect(unknown.status).toBe(502);expect(unknown.body.ok).not.toBe(true);
  const recovered=await run({provider});expect(recovered.body).toMatchObject({ok:true,status:'provider_accepted',id});
  expect(attempts).toBe(2);expect(receipts.size).toBe(1);
 });
 it('does not accept a non-UUID retry identity or silently generate a replacement',async()=>{
  const result=await run({key:'push:legacy:1'});expect(result.status).toBe(400);expect(result.fetch).not.toHaveBeenCalled();
 });
 it.each([{},null,[],{id:123},{id:'not-a-provider-id'},{id,recipients:-1},{id,recipients:'1'},{id,recipients:1.5}])('does not acknowledge malformed provider response %j',async(body)=>{
  const result=await run({body});expect(result.status).toBe(502);expect(result.body.ok).not.toBe(true);
 });
 it('separates explicit no-message response from a created notification',async()=>{
  const result=await run({body:{id:'',recipients:0,errors:['SYNTHETIC_PRIVATE_PROVIDER_DETAIL']}});
  expect(result.status).toBe(200);expect(result.body).toMatchObject({ok:false,status:'not_created',recipients:0});
  expect(JSON.stringify(result.body)).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_DETAIL');
 });
 it('does not fabricate zero recipients when a message ID exists without count metadata',async()=>{
  const result=await run({body:{id}});expect(result.status).toBe(200);expect(result.body).toMatchObject({ok:true,status:'provider_accepted',id,recipients:null});
 });
 it('retains a verified provider receipt, not an inbox delivery claim',async()=>{
  const result=await run();expect(result.status).toBe(200);expect(result.body).toEqual({ok:true,status:'provider_accepted',id,recipients:1});expect(result.fetch).toHaveBeenCalledOnce();
 });
 it.each(['denied','unconfigured','missing_key'])('keeps %s rejected before provider IO',async(mode)=>{
  const result=await run({secret:mode==='denied'?'wrong':'LOCAL_INTERNAL',configured:mode!=='unconfigured',key:mode==='missing_key'?'':jobKey});
  expect(result.status).toBe(mode==='denied'?401:mode==='unconfigured'?503:400);expect(result.fetch).not.toHaveBeenCalled();
 });
 it.each(['response','throw'])('does not expose private provider error on %s failure',async(mode)=>{
  const result=await run({status:502,body:{error:'SYNTHETIC_PRIVATE_PROVIDER_DETAIL'},throws:mode==='throw'});
  expect(result.status).toBe(502);expect(JSON.stringify(result.body)).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_DETAIL');
 });
});
