// Actual Edge handler, modeled RPC transport. Original rollback oracles retained; native245 proves transaction separately.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';
const actor='e5420000-0000-4000-8000-000000000001',purchaseId='e5420000-0000-4000-8000-000000000002',dealId='e5420000-0000-4000-8000-000000000003';
async function run(fault:'ledger_and_revert'|'audit'|'parent',input:Record<string,unknown>={purchase_id:purchaseId}){
 let handler!:(req:Request)=>Promise<Response>;
 const purchase={id:purchaseId,deal_id:dealId,backer_id:actor,percent:10,amount_vnd:100000,status:'committed',reference_code:'LOCAL542'};
 const deal={id:dealId,status:'committed',percentage_sold:10,filled_percent:10,early_closed:false,player_id:actor,club_id:null,custom_event_name:'LOCAL542 TEST'};
 const ledger:unknown[]=[];
 const rpc=vi.fn(async()=>({data:null,error:{code:'P0001',message:`LOCAL ${fault} failure`}}));
 const admin={rpc,auth:{admin:{getUserById:async()=>({data:{user:null},error:null})}},from:(table:string)=>{
  let action='select',payload:Record<string,unknown>={};
  const result=async()=>{
   if(table==='user_roles')return {data:[{role:'super_admin'}],error:null};
   if(table==='staking_purchases'&&action==='update'){
    if(fault==='ledger_and_revert'&&payload.status==='committed')return {data:null,error:{message:'LOCAL revert failed'}};
    Object.assign(purchase,payload);return {data:[{id:purchase.id}],error:null};
   }
   if(table==='staking_purchases')return {data:[{...purchase}],error:null};
   if(table==='escrow_transactions'&&action==='insert'){
    if(fault==='ledger_and_revert')return {data:null,error:{message:'LOCAL ledger failed'}};
    ledger.push(payload);return {data:null,error:null};
   }
   if(table==='staking_deals'&&action==='update'){
    if(fault==='parent')return {data:null,error:{message:'LOCAL parent failed'}};
    Object.assign(deal,payload);return {data:null,error:null};
   }
   if(table==='staking_audit_logs'&&action==='insert'&&fault==='audit')return {data:null,error:{message:'LOCAL audit failed'}};
   return {data:[],error:null};
  };
  const q={select:()=>q,eq:()=>q,in:()=>q,limit:()=>q,update:(value:Record<string,unknown>)=>{action='update';payload=value;return q;},
   insert:(value:Record<string,unknown>)=>{action='insert';payload=value;return q;},
   maybeSingle:async()=>({data:table==='staking_purchases'?{...purchase}:table==='staking_deals'?{...deal}:null,error:null}),
   then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>result().then(resolve,reject)};return q;
 }};
 const source=readFileSync('supabase/functions/admin-confirm-funded/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,Date,z,retryFetch:vi.fn(),console:{error:vi.fn()},
  corsHeaders:{},json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  authenticateUser:async()=>({uid:actor}),createAdminClient:()=>admin,requireAdminRoles:async()=>({isSuper:true,isCashier:false}),
  createClient:(_url:string,key:string)=>key==='LOCAL_ANON'?{auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}}:admin,
  parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),
  Deno:{env:{get:(key:string)=>key==='SUPABASE_ANON_KEY'?'LOCAL_ANON':'LOCAL_SERVICE'},serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/funded',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST_ONLY'},body:JSON.stringify(input)}));
 if(input.purchase_id&&!input.deal_id)expect(rpc).toHaveBeenCalledExactlyOnceWith('commit_staking_funding_v1',{p_actor:actor,p_purchase:purchaseId,p_bank_tx:null,p_note:null});
 else expect(rpc).not.toHaveBeenCalled();
 return {http:response.status,body:await response.json(),purchase,deal,ledger};
}
it.each(['ledger_and_revert','audit','parent'] as const)('does not leave a partial money commit on %s failure',async fault=>{
 const actual=await run(fault);expect(actual.body.success).not.toBe(true);
 expect(actual.purchase.status).toBe('committed');expect(actual.deal.status).toBe('committed');expect(actual.ledger).toHaveLength(0);
});
it.each([{deal_id:dealId},{deal_id:dealId,purchase_id:purchaseId}])('does not guess a purchase from legacy ambiguous intent %j',async input=>{
 const actual=await run('audit',input);expect(actual.http).toBe(400);expect(actual.body.code).toBe('PURCHASE_ID_REQUIRED');
 expect(actual.purchase.status).toBe('committed');expect(actual.ledger).toHaveLength(0);
});
