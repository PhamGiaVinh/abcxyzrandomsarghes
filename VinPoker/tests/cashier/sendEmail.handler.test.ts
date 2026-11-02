import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {describe,expect,it,vi} from 'vitest';
const sensitive='SYNTHETIC_PRIVATE_PROVIDER_DETAIL';
async function run({status=200,body:providerBody={id:'local-provider-id'},throws=false,authorized=true}:{status?:number;body?:unknown;throws?:boolean;authorized?:boolean}={}){
 let handler!:(req:Request)=>Promise<Response>;
 const errors=vi.fn(),fetch=vi.fn(async()=>{if(throws)throw new Error(sensitive);return new Response(JSON.stringify(providerBody),{status});});
 const source=readFileSync('supabase/functions/send-email/index.ts','utf8').replace(/^import[^\n]+\n/m,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  z,parseBody:async(req:Request,schema:z.ZodTypeAny)=>{const parsed=schema.safeParse(await req.json());return parsed.success?{ok:true,data:parsed.data}:{ok:false,response:new Response('{}',{status:400})};},
  Deno:{env:{get:(key:string)=>({SUPABASE_SERVICE_ROLE_KEY:'LOCAL_INTERNAL',RESEND_API_KEY:'LOCAL_PROVIDER'})[key]},serve:(fn:typeof handler)=>{handler=fn;}},
  fetch,Request,Response,console:{error:errors},
 });
 const response=await handler(new Request('http://local.invalid/email',{method:'POST',headers:{authorization:authorized?'Bearer LOCAL_INTERNAL':'Bearer outsider','content-type':'application/json'},
  body:JSON.stringify({to:'test@example.test',subject:'TEST',html:'<p>TEST only</p>'})}));
 return {status:response.status,body:await response.json(),logs:errors.mock.calls,fetch};
}
describe('actual internal email handler provider boundary (no delivery)',()=>{
 it.each(['response','throw'])('does not expose private provider details on %s failure',async(kind)=>{
  const r=await run({status:502,body:{id:'',message:sensitive},throws:kind==='throw'});
  expect(r.status).toBeGreaterThanOrEqual(500);
  expect(JSON.stringify({body:r.body,logs:r.logs})).not.toContain(sensitive);
  expect(r.body.success).not.toBe(true);
 });
 it.each([{},null,[],{id:''},{id:'   '},{id:123}])('requires a nonempty provider acknowledgement for %j',async(body)=>{
  const r=await run({body});
  expect(r.status).toBe(502);expect(r.body.success).not.toBe(true);
 });
 it('acknowledges a real-shaped provider ID without claiming inbox delivery',async()=>{
  const r=await run();expect(r.status).toBe(200);expect(r.body).toEqual({success:true,id:'local-provider-id'});expect(r.fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects an outsider before attempting any provider request',async()=>{
  const r=await run({authorized:false});expect(r.status).toBe(401);expect(r.fetch).not.toHaveBeenCalled();
 });
});
