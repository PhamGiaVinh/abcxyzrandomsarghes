import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',dealId='e5510000-0000-4000-8000-000000000001';
it.each(['parent','audit','zero_row'])('legacy actual handler cannot leave a ledger-only success on %s failure',async fault=>{
 let handler!:(req:Request)=>Promise<Response>;const ledger:unknown[]=[];
 const deal={id:dealId,status:'committed',backer_id:actor,escrow_amount_vnd:100000};
 const rpc=vi.fn(async()=>({data:null,error:{code:'P0001',message:`LOCAL551_${fault}`}}));
 const admin={rpc,from:(table:string)=>{
  let action='select',payload:Record<string,unknown>={};
  const result=async()=>{
   if(table==='escrow_transactions'&&action==='insert'){ledger.push(payload);return {data:null,error:null};}
   if(table==='staking_deals'&&action==='update'){
    if(fault==='parent')return {data:null,error:{message:'LOCAL parent fault'}};
    if(fault!=='zero_row')Object.assign(deal,payload);return {data:[],error:null};
   }
   if(table==='staking_audit_logs'&&action==='insert'&&fault==='audit')return {data:null,error:{message:'LOCAL audit fault'}};
   return {data:[],error:null};
  };
  const q={select:()=>q,eq:()=>q,update:(p:Record<string,unknown>)=>{action='update';payload=p;return q;},insert:(p:Record<string,unknown>)=>{action='insert';payload=p;return q;},
   maybeSingle:async()=>({data:table==='user_roles'?{role:'super_admin'}:{...deal},error:null}),then:(r:(v:unknown)=>unknown)=>result().then(r)};return q;
 }};
 const source=readFileSync('supabase/functions/staking-confirm-funded/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  createAdminClient:()=>admin,authenticateUser:async()=>({uid:actor}),parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),Deno:{serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/legacy-funding',{method:'POST',body:JSON.stringify({deal_id:dealId,bank_tx_id:'LOCAL551',amount_vnd:100000})}));
 const body=await response.json();expect(body.success).not.toBe(true);expect(deal.status).toBe('committed');expect(ledger).toHaveLength(0);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('commit_staking_legacy_funding_v1',{p_actor:actor,p_deal:dealId,p_bank_tx:'LOCAL551',p_amount:100000,p_proof:null,p_note:null});
});
