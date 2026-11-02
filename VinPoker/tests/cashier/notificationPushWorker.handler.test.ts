import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {constantTimeEqual,isUuid,parsePushPayload} from '../../supabase/functions/_shared/internal-trigger-auth';

const notice='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';
const token='33333333-3333-4333-8333-333333333333',providerId='44444444-4444-4444-8444-444444444444';
const job=()=>({id:jobId,notification_id:notice,lease_token:token,state:'processing',lease_expires_at:new Date(Date.now()+120000).toISOString(),
 payload:{user_id:notice,heading:'LOCAL TEST',message:'LOCAL ONLY',url:'/tournaments'}});
async function run({enabled=true,bearer='LOCAL_SERVICE',body={notification_id:notice},claimed=job() as unknown,claimError=false,finish=true as unknown,finishError=false,providerThrows=false,
 providerBody={ok:true,status:'provider_accepted',id:providerId}}={}){
 let handler!:(req:Request)=>Promise<Response>;
 const rpc=vi.fn(async(name:string)=>name==='claim_notification_push_v1'?{data:{ok:true,job:claimed},error:claimError?{}:null}:{data:finish,error:finishError?{}:null});
 const fetch=vi.fn(async()=>{if(providerThrows)throw Error('PRIVATE_PROVIDER');return new Response(JSON.stringify(providerBody));});
 const createClient=vi.fn(()=>({rpc}));
 const source=readFileSync('supabase/functions/notification-push-worker/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  constantTimeEqual,isUuid,parsePushPayload,createClient,fetch,Request,Response,URL,Date,
  // jsdom lacks Node/Deno AbortSignal.timeout; timing itself is not this IO model's claim.
  AbortSignal:{timeout:()=>new AbortController().signal},
  Deno:{env:{get:(name:string)=>({NOTIFICATION_PUSH_WORKER_ENABLED:enabled?'true':'false',SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_SERVICE',DEALER_TRIGGER_INTERNAL_SECRET:'LOCAL_INTERNAL'})[name]},serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/worker',{method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify(body)}));
 return {status:response.status,body:await response.json(),rpc,fetch,createClient};
}
describe('actual push worker handler, external and DB IO modeled',()=>{
 it('stays dark without DB/provider work',async()=>{const r=await run({enabled:false});expect(r.status).toBe(404);expect(r.createClient).not.toHaveBeenCalled();expect(r.fetch).not.toHaveBeenCalled();});
 it('rejects ordinary bearer before privileged work',async()=>{const r=await run({bearer:'user'});expect(r.status).toBe(401);expect(r.createClient).not.toHaveBeenCalled();});
 it('uses exact job identity and fenced finish, not a device delivery claim',async()=>{
  const r=await run();expect(r.status).toBe(200);expect(r.body).toMatchObject({ok:true,status:'processed',provider_accepted:1});
  expect(r.rpc).toHaveBeenNthCalledWith(1,'claim_notification_push_v1',{p_notification_id:notice});
  expect(r.fetch).toHaveBeenCalledWith('http://local.invalid/functions/v1/send-push-notification',expect.objectContaining({headers:expect.objectContaining({'x-idempotency-key':jobId,'x-vinpoker-internal-secret':'LOCAL_INTERNAL'})}));
  expect(r.rpc).toHaveBeenNthCalledWith(2,'finish_notification_push_v1',{p_id:jobId,p_token:token,p_outcome:'provider_accepted',p_provider_id:providerId});
 });
 it('does not finish unknown provider outcomes',async()=>{const r=await run({providerThrows:true});expect(r.status).toBe(503);expect(r.rpc).toHaveBeenCalledTimes(1);expect(r.body.ok).toBe(false);});
 it.each([false,null,'true'])('does not report success for unverified finish %j',async(finish)=>{const r=await run({finish});expect(r.status).toBe(503);expect(r.body.ok).toBe(false);});
 it('does not call provider on claim failure',async()=>{const r=await run({claimError:true});expect(r.status).toBe(503);expect(r.fetch).not.toHaveBeenCalled();});
 it('does not report success when finish transport fails',async()=>{const r=await run({finishError:true});expect(r.status).toBe(503);expect(r.body.ok).toBe(false);});
 it('marks invalid frozen payload for attention without provider work',async()=>{
  const r=await run({claimed:{...job(),payload:{user_id:'bad'}}});expect(r.status).toBe(200);expect(r.body.status).toBe('needs_attention');expect(r.fetch).not.toHaveBeenCalled();
  expect(r.rpc).toHaveBeenNthCalledWith(2,'finish_notification_push_v1',{p_id:jobId,p_token:token,p_outcome:'needs_attention',p_provider_id:null});
 });
 it('records explicit not-created separately from provider acceptance',async()=>{
  const r=await run({providerBody:{ok:false,status:'not_created',error:'push_not_created',recipients:0} as never});
  expect(r.status).toBe(200);expect(r.body).toMatchObject({provider_accepted:0,not_created:1});
  expect(r.rpc).toHaveBeenNthCalledWith(2,'finish_notification_push_v1',{p_id:jobId,p_token:token,p_outcome:'not_created',p_provider_id:null});
 });
 it.each([{limit:5},{notification_id:'bad'},[],null])('rejects malformed scope before IO %j',async(body)=>{
  const r=await run({body:body as never});expect(r.status).toBe(400);expect(r.createClient).not.toHaveBeenCalled();
 });
 it.each([null,{}, {...job(),notification_id:providerId},{...job(),lease_expires_at:'bad'},{...job(),state:'pending'}])('handles empty or malformed claim without provider %j',async(claimed)=>{
  const r=await run({claimed});expect(r.fetch).not.toHaveBeenCalled();expect(r.status).toBe(claimed===null?200:503);
 });
 it('does not treat no claimable jobs as all delivered',async()=>{const r=await run({claimed:null});expect(r.body.status).toBe('no_claimable_jobs');expect(r.body.provider_accepted).toBe(0);});
});
