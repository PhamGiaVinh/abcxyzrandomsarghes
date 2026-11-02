// Actual Edge handler -> actual atomic RPC fault; native fixture entirely ROLLBACK.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5';
const deal='e5300000-0000-4000-8000-000000000002',request='e5300000-0000-4000-8000-000000000003';
it.skipIf(process.env.VINPOKER_NATIVE_DB_TEST!=='1').each(['staking_purchases','escrow_transactions','staking_audit_logs'])(
 'actual handler refuses partial refund after native %s fault',async stage=>{
 let handler!:(req:Request)=>Promise<Response>;
 const effects=vi.fn();
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe('commit_staking_refund_v1');expect(args).toEqual({p_actor:actor,p_request:request,p_deal:deal,p_reason:'LOCAL530'});
  const sql=`BEGIN;SET LOCAL statement_timeout='15s';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));END $$;
CREATE FUNCTION pg_temp.refund530_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('vinpoker.refund530_fault',true)='on' AND TG_TABLE_NAME='${stage}' AND (TG_TABLE_NAME<>'escrow_transactions' OR (to_jsonb(NEW)->>'amount_vnd')::bigint=60000)
 THEN RAISE EXCEPTION 'LOCAL530_NATIVE_FAULT';END IF;RETURN NEW;END $$;
CREATE TRIGGER local530_p BEFORE UPDATE ON public.staking_purchases FOR EACH ROW EXECUTE FUNCTION pg_temp.refund530_fault();
CREATE TRIGGER local530_l BEFORE INSERT ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.refund530_fault();
CREATE TRIGGER local530_a BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.refund530_fault();
INSERT INTO public.user_roles(user_id,role) SELECT '${actor}','super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${actor}' AND role='super_admin');
INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
SELECT '${deal}','${actor}',id,'LOCAL530 handler rollback',now(),'LOCAL ONLY',10,1,1000000,'funded' FROM public.clubs ORDER BY id LIMIT 1;
INSERT INTO public.staking_purchases(deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
SELECT '${deal}','${actor}',5,1,amount,'funded',gen_random_uuid()::text FROM unnest(ARRAY[50000,60000]) amount;
SET LOCAL vinpoker.refund530_fault='on';SET LOCAL ROLE service_role;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.commit_staking_refund_v1('${actor}','${request}','${deal}','LOCAL530');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'LOCAL530_NATIVE_FAULT' THEN RAISE;END IF;denied:=true;END;ASSERT denied;END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT (SELECT status='funded' FROM public.staking_deals WHERE id='${deal}');
 ASSERT (SELECT count(*)=2 FROM public.staking_purchases WHERE deal_id='${deal}' AND status='funded');
 ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id='${deal}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_refund_receipts_v1 WHERE deal_id='${deal}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='refunded');
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_refund_email_intents_v1 WHERE deal_id='${deal}');
END $$;
SELECT jsonb_build_object('error','LOCAL530_NATIVE_FAULT','deal','funded','funded_purchases',2,'ledger',0,'receipt',0);ROLLBACK;`;
  const output=execFileSync('wsl.exe',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
   'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000});
  expect(JSON.parse(output.trim())).toEqual({error:'LOCAL530_NATIVE_FAULT',deal:'funded',funded_purchases:2,ledger:0,receipt:0});
  return {data:null,error:{code:'P0001',message:'LOCAL530_NATIVE_FAULT'}};
 });
 const source=readFileSync('supabase/functions/staking-process-refund/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  createAdminClient:()=>({rpc}),authenticateUser:async()=>({uid:actor}),requireAdminRoles:async()=>({isSuper:true,isCashier:false}),
  drainStakingRefundEmails:effects,parseRefundEmailStatus:vi.fn(),
  parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),
  Deno:{serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/refund',{method:'POST',body:JSON.stringify({deal_id:deal,request_id:request,reason:'LOCAL530'})}));
 expect(response.status).toBe(409);expect((await response.json()).success).not.toBe(true);expect(rpc).toHaveBeenCalledTimes(1);expect(effects).not.toHaveBeenCalled();
});
