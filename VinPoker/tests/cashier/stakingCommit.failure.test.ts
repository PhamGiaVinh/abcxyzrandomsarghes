// Real Edge handler. Legacy table adapter retains the original repro seam;
// atomic RPC adapter models server serialization, not native concurrency proof.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it} from 'vitest';
const dealId='e5000000-0000-4000-8000-000000000001';
const player='e5000000-0000-4000-8000-000000000002';
async function scenario(mode:'overlap'|'read_error',nativeRpc?:(args:Record<string,unknown>)=>unknown){
 let handler!:(req:Request)=>Promise<Response>;
 const deal={id:dealId,player_id:player,status:'listing',admin_review_status:'approved',percentage_sold:10,
  filled_percent:0,min_purchase_percent:5,buy_in_amount_vnd:1000000,markup:1,early_closed:false,club_id:null};
 const purchases:Record<string,unknown>[]=[];
 let readers=0,release!:()=>void;
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 const admin={rpc:async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe('commit_staking_purchase_v2');
  expect(args.p_request).toMatch(/^[0-9a-f-]{36}$/i);
  if(nativeRpc)return nativeRpc(args);
  if(mode==='read_error')return {data:null,error:{message:'LOCAL database unavailable'}};
  if(deal.filled_percent+Number(args.p_percent)>deal.percentage_sold)
   return {data:null,error:{message:'staking_purchase_capacity_conflict'}};
  const p={id:`e5000000-0000-4000-8000-${String(purchases.length+10).padStart(12,'0')}`,percent:args.p_percent};
  purchases.push(p);deal.filled_percent+=Number(args.p_percent);deal.status='committed';
  return {data:{success:true,purchase_id:p.id,reference_code:'LOCAL_ONLY',amount_vnd:100000,committed_at:'2026-10-23T00:00:00+00:00',
   bank_name:'TEST',account_number:'LOCAL_ONLY',account_holder:'TEST',qr_code_url:null,
   deal_status:'committed',filled_percent:deal.filled_percent},error:null};
 },from:(table:string)=>{
  let action='select',payload:Record<string,unknown>|undefined;
  const result=async()=>{
   if(table==='staking_purchases'&&action==='select'){
    if(mode==='read_error')return {data:null,error:{message:'LOCAL purchases read failed'}};
    const snapshot=purchases.map(p=>({...p}));readers++;if(readers===2)release();await barrier;
    return {data:snapshot,error:null};
   }
   if(table==='staking_purchases'&&action==='insert'){
    const p={...payload,id:`e5000000-0000-4000-8000-${String(purchases.length+10).padStart(12,'0')}`};purchases.push(p);
    return {data:p,error:null};
   }
   if(table==='staking_deals'&&action==='update'){Object.assign(deal,payload);return {data:null,error:null};}
   return {data:[],error:null};
  };
  const single=async()=>{
   if(action!=='select')return result();
   if(table==='profiles')return {data:{bank_account_number:'LOCAL_ONLY',bank_name:'TEST',bank_account_holder:'TEST'},error:null};
   if(table==='staking_deals')return {data:{...deal},error:null};
   if(table==='platform_bank_accounts')return {data:{id:dealId,bank_name:'TEST',account_number:'LOCAL_ONLY',account_holder:'TEST'},error:null};
   return {data:null,error:null};
  };
  const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,limit:()=>q,
   insert:(p:Record<string,unknown>)=>{payload=p;action='insert';return q;},
   update:(p:Record<string,unknown>)=>{payload=p;action='update';return q;},delete:()=>q,
   maybeSingle:single,single,then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>result().then(resolve,reject)};
  return q;
 }};
 const source=readFileSync('supabase/functions/staking-commit-deal/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,Date,Math,z,retryFetch:()=>{},
  createClient:()=>({...admin,auth:{getUser:async(token:string)=>({data:{user:{id:token}},error:null})}}),
  parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),
  Deno:{env:{get:()=> 'LOCAL_TEST_ONLY'},serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const send=(id:number)=>handler(new Request('http://local.invalid/commit',{method:'POST',headers:{Authorization:`Bearer e5000000-0000-4000-8000-${String(id).padStart(12,'0')}`},body:JSON.stringify({deal_id:dealId,request_id:`e5000000-0000-4000-8000-${String(id+100).padStart(12,'0')}`,percent:10})}));
 const responses=mode==='overlap'?await Promise.all([send(3),send(4)]):[await send(3)];
 return {statuses:responses.map(r=>r.status),purchases,deal};
}
it('cannot sell more than the offered percentage when two backers overlap',async()=>{
 const result=await scenario('overlap');
 expect(result.purchases.reduce((sum,p)=>sum+Number(p.percent),0)).toBeLessThanOrEqual(10);
 expect(result.statuses.filter(s=>s===200)).toHaveLength(1);
});
it('does not treat a failed purchase read as zero existing commitments',async()=>{
 const result=await scenario('read_error');
 expect(result.statuses[0]).toBeGreaterThanOrEqual(400);expect(result.purchases).toHaveLength(0);
});
it.runIf(process.env.VINPOKER_NATIVE_DB_TEST==='1')('passes a native committed purchase receipt through the actual handler',async()=>{
 const dbArgs=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=(input:string)=>execFileSync('wsl',dbArgs,{input,encoding:'utf8',timeout:15000}).trim();
 expect(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();")).toBe('vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const facts=()=>sql(`SELECT md5(jsonb_build_array(${['staking_deals','staking_purchases','staking_audit_logs','staking_purchase_receipts_v1','notifications','platform_bank_accounts','profiles'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
 const before=facts();let calls=0;
 const actual=await scenario('read_error',args=>{
  calls++;const buyer=String(args.p_actor),req=String(args.p_request);
  const lines=sql(`BEGIN;SET LOCAL statement_timeout='5s';
   DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');END $$;
   INSERT INTO auth.users(id) VALUES('${buyer}'),('${player}');
   INSERT INTO public.profiles(user_id,display_name,bank_name,bank_account_number,bank_account_holder)
   VALUES('${buyer}','LOCAL506 buyer','LOCAL','LOCAL_ONLY','TEST');
   INSERT INTO public.platform_bank_accounts(bank_name,account_number,account_holder,account_type,club_id)
   SELECT 'LOCAL','LOCAL_ONLY','TEST','escrow',id FROM public.clubs ORDER BY id LIMIT 1;
   INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
   SELECT '${dealId}','${player}',id,'LOCAL506 handler',now(),'LOCAL ONLY',10,1,1000000,'listing','approved' FROM public.clubs ORDER BY id LIMIT 1;
   SET LOCAL ROLE service_role;
   SELECT public.commit_staking_purchase_v2('${buyer}','${req}','${dealId}',10);
   SELECT public.commit_staking_purchase_v2('${buyer}','${req}','${dealId}',10);
   DO $$ BEGIN PERFORM set_config('vinpoker.commit517_original',(public.commit_staking_purchase_v2('${buyer}','${req}','${dealId}',10)->>'committed_at'),true);END $$;
   RESET ROLE;
   DO $$ BEGIN
    ASSERT (SELECT count(*)=1 AND sum(percent)=10 FROM public.staking_purchases WHERE deal_id='${dealId}');
    ASSERT (SELECT count(*)=1 FROM public.staking_purchase_receipts_v1 WHERE deal_id='${dealId}');
    ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id='${dealId}' AND action='committed');
    ASSERT (SELECT current_setting('vinpoker.commit517_original')::timestamptz=committed_at FROM public.staking_purchases WHERE deal_id='${dealId}');
   END $$;ROLLBACK;`).split(/\r?\n/).map(line=>JSON.parse(line));
  expect(lines).toHaveLength(2);expect(lines[0]).toEqual(lines[1]);expect(lines[0].amount_vnd).toBe(100000);
  return {data:lines[0],error:null};
 });
 expect(actual.statuses).toEqual([200]);expect(calls).toBe(1);expect(facts()).toBe(before);
});
