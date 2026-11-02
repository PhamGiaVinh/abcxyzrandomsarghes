// Real Edge handler, modeled Auth/PostgREST/storage; no network or DB writes.
// Original rollback oracles retained; atomic RPC fault transport modeled here.
// Native fault suite244/254 separately proves transaction rollback in PostgreSQL.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';

const dealId='e4880000-0000-4000-8000-000000000001';
const actor='e4880000-0000-4000-8000-000000000002';
const requestId='e5300000-0000-4000-8000-000000000001';
async function runFault(fault:'purchase_update'|'second_ledger'|'audit_insert') {
 let handler!:(req:Request)=>Promise<Response>;
 const deal:Record<string,unknown>={id:dealId,player_id:actor,club_id:null,status:'funded',custom_event_name:'Rollback488 TEST'};
 const purchases=[1,2].map(n=>({id:`e4880000-0000-4000-8000-00000000001${n}`,backer_id:actor,percent:5,amount_vnd:50000,status:'funded'}));
 const ledger:unknown[]=[];let ledgerAttempts=0;
 const rpc=vi.fn(async()=>({data:null,error:{code:'P0001',message:`LOCAL ${fault} unavailable`}}));
 const admin={rpc,auth:{admin:{getUserById:async()=>({data:{user:null},error:null})}},from:(table:string)=>{
  let action='select',payload:Record<string,unknown>|null=null;
  const statusFilters:string[][]=[];
  const result=async()=>{
   if(table==='staking_deals'&&action==='update'){
    if(!statusFilters.every(filter=>filter.includes(String(deal.status))))return {data:[],error:null};
    Object.assign(deal,payload);return {data:[{id:dealId}],error:null};
   }
   if(table==='staking_purchases'&&action==='update'){
    if(fault==='purchase_update')return {data:null,error:{message:'LOCAL purchase write unavailable'}};
    const changed=purchases.filter(row=>statusFilters.every(filter=>filter.includes(row.status)));
    for(const row of changed)Object.assign(row,payload);
    return {data:changed.map(row=>({...row})),error:null};
   }
   if(table==='escrow_transactions'&&action==='insert'){
    ledgerAttempts++;
    if(fault==='second_ledger'&&ledgerAttempts===2)return {data:null,error:{message:'LOCAL ledger unavailable'}};
    ledger.push(payload);return {data:null,error:null};
   }
   if(table==='staking_audit_logs'&&action==='insert'&&fault==='audit_insert'){
    return {data:null,error:{message:'LOCAL audit unavailable'}};
   }
   // Notification sinks are local/no-op; no provider transmission occurs.
   return {data:[],error:null};
  };
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==='status')statusFilters.push([value]);return q;},
   in:(key:string,values:string[])=>{if(key==='status')statusFilters.push(values);return q;},
   update:(value:Record<string,unknown>)=>{action='update';payload=value;return q;},
   insert:(value:Record<string,unknown>)=>{action='insert';payload=value;return q;},
   maybeSingle:async()=>({data:{...deal},error:null}),
   then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>result().then(resolve,reject)};
  return q;
 }};
 const source=readFileSync('supabase/functions/staking-process-refund/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,Date,console:{error:vi.fn()},z,retryFetch:vi.fn(),corsHeaders:{},
  json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  createClient:()=>({auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}}),createAdminClient:()=>admin,
  authenticateUser:async()=>({uid:actor}),
  requireAdminRoles:async()=>({isSuper:true,isCashier:false}),
  parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),
  Deno:{env:{get:()=> 'LOCAL_TEST_ONLY'},serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/refund',{method:'POST',headers:{Authorization:'Bearer LOCAL_TEST_ONLY'},
  body:JSON.stringify({deal_id:dealId,request_id:requestId,reason:'TEST488 rollback invariant'})}));
 expect(rpc).toHaveBeenCalledExactlyOnceWith('commit_staking_refund_v1',{
  p_actor:actor,p_request:requestId,p_deal:dealId,p_reason:'TEST488 rollback invariant'});
 return {http:response.status,response:await response.json(),deal:{...deal},purchases:purchases.map(row=>({...row})),ledger};
}
it('leaves deal and funded purchases unchanged when purchase transition fails',async()=>{
 const actual=await runFault('purchase_update');
 expect(actual.http).toBeGreaterThanOrEqual(400);
 expect(actual.deal.status).toBe('funded');
 expect(actual.purchases.map(row=>row.status)).toEqual(['funded','funded']);
 expect(actual.ledger).toHaveLength(0);
});
it('does not commit partial refund statuses or one-sided ledger when the second ledger row fails',async()=>{
 const actual=await runFault('second_ledger');
 expect(actual.response.success).not.toBe(true);
 expect(actual.deal.status).toBe('funded');
 expect(actual.purchases.map(row=>row.status)).toEqual(['funded','funded']);
 expect(actual.ledger).toHaveLength(0);
});
it('does not complete a money transition without its required audit record',async()=>{
 const actual=await runFault('audit_insert');
 expect(actual.response.success).not.toBe(true);
 expect(actual.deal.status).toBe('funded');
 expect(actual.purchases.map(row=>row.status)).toEqual(['funded','funded']);
 expect(actual.ledger).toHaveLength(0);
});
