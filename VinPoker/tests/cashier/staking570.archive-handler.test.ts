import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';
const actor='e5700000-0000-4000-8000-000000000001',deal='e5700000-0000-4000-8000-000000000002';
const canonical={success:true,deal_id:deal,status:'cancelled',archived:true};
async function run(options:{data?:unknown;rpcError?:{code:string;message:string};cashier?:boolean;unauth?:boolean;body?:unknown;method?:string;read?:boolean}={}){
 let handler!:(req:Request)=>Promise<Response>;
 const rpc=vi.fn(async()=>({data:Object.hasOwn(options,'data')?options.data:canonical,error:options.rpcError??null}));
 const source=readFileSync(`supabase/functions/${options.read?'admin-staking-listing-archive-status':'admin-archive-staking-listing'}/index.ts`,'utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 const createAdminClient=vi.fn(()=>({rpc}));
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(value:unknown,status=200)=>new Response(JSON.stringify(value),{status}),
  authenticateUser:async()=>options.unauth?new Response('{}',{status:401}):{uid:actor},
  requireAdminRoles:async()=>({isSuper:!options.cashier,isCashier:!!options.cashier}),createAdminClient,
  parseBody:async(req:Request,schema:z.ZodType)=>{const value=schema.safeParse(await req.json());return value.success?{ok:true,data:value.data}:{ok:false,response:new Response('{}',{status:400})};},Deno:{serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const method=options.method??'POST';const response=await handler(new Request('http://local.invalid/archive',{method,...(method==='POST'?{body:JSON.stringify(options.body??{deal_id:deal,expected_review:'rejected'})}:{})}));
 return {response,body:await response.json(),rpc,createAdminClient};
}
it('calls the canonical archive exactly once for the authenticated actor, no automatic retries',async()=>{
 const result=await run();expect(result.response.status).toBe(200);expect(result.body).toEqual(canonical);
 expect(result.rpc).toHaveBeenCalledExactlyOnceWith('archive_staking_listing_v1',{p_actor:actor,p_deal:deal,p_expected_review:'rejected'});expect(result.createAdminClient).toHaveBeenCalledWith({retry:false});
});
it.each([null,{}, {...canonical,deal_id:actor},{...canonical,status:'listing'},{...canonical,archived:false},{...canonical,error:'denied'}])('rejects unverified receipt %j',async data=>{
 const result=await run({data});expect(result.response.status).toBe(502);expect(result.body.success).not.toBe(true);
});
it.each([{cashier:true,status:403},{unauth:true,status:401},{method:'GET',status:405}])('denies before RPC %j',async options=>{
 const result=await run(options);expect(result.response.status).toBe(options.status);expect(result.rpc).not.toHaveBeenCalled();
});
it.each([{deal_id:deal,expected_review:'pending'},{deal_id:deal,expected_review:'rejected',actor_id:actor}])('rejects malformed or client-authority payload %j',async body=>{
 const result=await run({body});expect(result.response.status).toBe(400);expect(result.rpc).not.toHaveBeenCalled();
});
it.each(['staking_archive_state_conflict','staking_archive_dependencies_present','staking_archive_receipt_conflict'])('reports %s as conflict, not archive success',async message=>{
 const result=await run({rpcError:{code:'P0001',message}});expect(result.response.status).toBe(409);expect(result.rpc).toHaveBeenCalledOnce();expect(result.body.success).not.toBe(true);
});
it('reads only the authenticated exact-deal receipt, never the archive writer',async()=>{
 const result=await run({read:true});expect(result.response.status).toBe(200);expect(result.body).toEqual(canonical);
 expect(result.rpc).toHaveBeenCalledExactlyOnceWith('get_staking_listing_archive_receipt_v1',{p_actor:actor,p_deal:deal,p_expected_review:'rejected'});
});
it.each(['not_recorded','needs_attention'])('returns strict read observation %s without reporting archive success',async state=>{
 const data={success:false,deal_id:deal,state};const result=await run({read:true,data});expect(result.response.status).toBe(200);expect(result.body).toEqual(data);expect(result.rpc).toHaveBeenCalledOnce();
});
it.each([{},null,{...canonical,deal_id:actor},{success:false,deal_id:deal,state:'not_recorded',retry_safe:true}])('rejects malformed or extra-authority read data %j',async data=>{
 const result=await run({read:true,data});expect(result.response.status).toBe(502);expect(result.body.success).not.toBe(true);
});
it.each([{cashier:true,status:403},{unauth:true,status:401}])('denies unprivileged read before RPC %j',async options=>{
 const result=await run({...options,read:true});expect(result.response.status).toBe(options.status);expect(result.rpc).not.toHaveBeenCalled();
});
