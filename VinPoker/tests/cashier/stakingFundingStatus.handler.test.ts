import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';
import {parseFundingEmailStatus} from '../../supabase/functions/_shared/stakingFundingEffects';
const actor='e5610000-0000-4000-8000-000000000001',purchase='e5610000-0000-4000-8000-000000000002';
const canonical={success:true,purchase_id:purchase,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0,
 delivery:{purchase_id:purchase,expected:2,total:2,delivered:1,pending:0,processing:0,needs_attention:1,evidence_missing:false,state:'needs_attention'}};
async function run(options:{data?:unknown;rpcError?:{code:string};role?:'denied';auth?:'denied'}={}){
 let handler!:(req:Request)=>Promise<Response>;
 const rpc=vi.fn(async()=>({data:Object.hasOwn(options,'data')?options.data:canonical,error:options.rpcError??null}));
 const createAdminClient=vi.fn(()=>({rpc}));
 const source=readFileSync('supabase/functions/admin-staking-funding-status/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,parseFundingEmailStatus,corsHeaders:{},json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  authenticateUser:async()=>options.auth?new Response('{}',{status:401}):{uid:actor},
  requireAdminRoles:async()=>options.role?new Response('{}',{status:403}):{isCashier:true,isSuper:false},createAdminClient,
  parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),Deno:{serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/funding-status',{method:'POST',body:JSON.stringify({purchase_id:purchase})}));
 return {response,body:await response.json(),rpc,createAdminClient};
}
it('reads only the exact actor/purchase receipt and does not dispatch money or email',async()=>{
 const result=await run();expect(result.response.status).toBe(200);expect(result.body).toEqual(canonical);
 expect(result.rpc).toHaveBeenCalledExactlyOnceWith('get_staking_funding_receipt_v1',{p_actor:actor,p_purchase:purchase});expect(result.createAdminClient).toHaveBeenCalledWith({retry:false});
});
it.each([null,{}, {...canonical,purchase_id:actor},{...canonical,delivery:{...canonical.delivery,state:'all_delivered'}},
 {...canonical,error:'denied'},{...canonical,ok:false}])('does not return success from unverified status %j',async data=>{
 const result=await run({data});expect(result.response.status).toBe(502);expect(result.body.success).not.toBe(true);
});
it.each([['role',403],['auth',401]] as const)('denies %s before status RPC',async(kind,status)=>{
 const result=await run({[kind]:'denied'});expect(result.response.status).toBe(status);expect(result.rpc).not.toHaveBeenCalled();
});
it('propagates current database authority denial without funding retry',async()=>{
 const result=await run({rpcError:{code:'42501'}});expect(result.response.status).toBe(403);expect(result.rpc).toHaveBeenCalledTimes(1);
});
it.each(['not_recorded','needs_attention'])('returns authorized %s as an observation, never financial success',async state=>{
 const data={success:false,purchase_id:purchase,state};const result=await run({data});
 expect(result.response.status).toBe(200);expect(result.body).toEqual(data);expect(result.rpc).toHaveBeenCalledTimes(1);
});
it.each([{success:false,purchase_id:actor,state:'not_recorded'},
 {success:false,purchase_id:purchase,state:'not_recorded',retry_safe:true}])('rejects unverified pending scope or extra authority %j',async data=>{
 const result=await run({data});expect(result.response.status).toBe(502);
});
