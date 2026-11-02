// Actual Edge handler; modeled Auth/PostgREST. Opt-in native case uses rollback SQL.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it} from 'vitest';
const actor='e4970000-0000-4000-8000-000000000001';
const dealId='e4970000-0000-4000-8000-000000000002';
async function run(fault:'purchase_read'|'changed_status'|'none',nativeRpc?:()=>unknown){
 let handler!:(req:Request)=>Promise<Response>;
 const deal={id:dealId,player_id:actor,status:'committing',filled_percent:5,percentage_sold:10,early_closed:false};
 let writes=0;
 const admin={rpc:async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe('close_staking_deal_early_v1');
  expect(args).toEqual({p_actor:actor,p_deal:dealId});
  if(nativeRpc)return {data:nativeRpc(),error:null};
  if(fault==='purchase_read')return {data:null,error:{message:'LOCAL database read unavailable'}};
  if(fault==='changed_status'){
   deal.status='funded';return {data:null,error:{message:'staking_close_state_conflict'}};
  }
  writes++;deal.status='committed';deal.early_closed=true;
  return {data:{success:true,deal_status:'committed',filled_percent:5},error:null};
 }};
 const source=readFileSync('supabase/functions/staking-close-early/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,Date,z,corsHeaders:{},createAdminClient:()=>admin,authenticateUser:async()=>({uid:actor}),
  json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),
  Deno:{serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/close',{method:'POST',body:JSON.stringify({deal_id:dealId})}));
 return {http:response.status,body:await response.json(),deal,writes};
}
it('does not cancel a deal when the purchase read failed',async()=>{
 const actual=await run('purchase_read');
 expect(actual.http).toBeGreaterThanOrEqual(400);expect(actual.writes).toBe(0);expect(actual.deal.status).toBe('committing');
});
it('does not overwrite a newer funded state using an old committing snapshot',async()=>{
 const actual=await run('changed_status');
 expect(actual.http).toBe(409);expect(actual.writes).toBe(0);expect(actual.deal.status).toBe('funded');
});
it('still accepts a valid unchanged partial deal',async()=>{
 const actual=await run('none');expect(actual.http).toBe(200);expect(actual.body.success).toBe(true);
 expect(actual.deal.status).toBe('committed');expect(actual.writes).toBe(1);
});
it.runIf(process.env.VINPOKER_NATIVE_DB_TEST==='1')('passes actual PostgreSQL atomic receipt through actual handler',async()=>{
 const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=(input:string)=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
 expect(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();")).toBe('vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const facts=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_deals x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_purchases x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY deal_id) FROM public.staking_close_early_receipts_v1 x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x))::text);`);
 const before=facts();let calls=0;
 const actual=await run('none',()=>{
  calls++;
  const lines=sql(`BEGIN;SET LOCAL statement_timeout='5s';
   DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');END $$;
   INSERT INTO auth.users(id) VALUES('${actor}');
   INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
   SELECT '${dealId}','${actor}',id,'LOCAL499 handler rollback',now(),'LOCAL ONLY',10,1,1000000,'committing' FROM public.clubs ORDER BY id LIMIT 1;
   INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
   VALUES(gen_random_uuid(),'${dealId}','${actor}',5,1,50000,'committed',gen_random_uuid()::text);
   SET LOCAL ROLE service_role;
   SELECT public.close_staking_deal_early_v1('${actor}','${dealId}');
   SELECT public.close_staking_deal_early_v1('${actor}','${dealId}');
   RESET ROLE;
   DO $$ BEGIN
    ASSERT (SELECT status='committed' AND early_closed AND filled_percent=5 FROM public.staking_deals WHERE id='${dealId}');
    ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id='${dealId}' AND action='player_close_early');
    ASSERT (SELECT count(*)=1 FROM public.staking_close_early_receipts_v1 WHERE deal_id='${dealId}');
   END $$;ROLLBACK;`).split(/\r?\n/).map(line=>JSON.parse(line));
  expect(lines).toHaveLength(2);expect(lines[0]).toEqual(lines[1]);return lines[0];
 });
 expect(actual.http).toBe(200);expect(actual.body).toEqual({success:true,deal_status:'committed',filled_percent:5});
 expect(calls).toBe(1);expect(facts()).toBe(before);
});
