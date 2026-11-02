import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {expect,it,vi} from 'vitest';

const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',deal='e5520000-0000-4000-8000-000000000001';
it.skipIf(process.env.VINPOKER_NATIVE_DB_TEST!=='1').each(['escrow_transactions','staking_deals','staking_audit_logs','staking_legacy_funding_receipts_v1','skip','success'])(
 'actual legacy funding handler/native RPC: %s',async stage=>{
 let handler!:(req:Request)=>Promise<Response>;
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe('commit_staking_legacy_funding_v1');
  expect(args).toEqual({p_actor:actor,p_deal:deal,p_bank_tx:'LOCAL552',p_amount:100000,p_proof:'https://local.invalid/proof',p_note:'LOCAL TEST'});
  const sql=`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL request.jwt.claim.sub='';
DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
ASSERT NOT EXISTS(SELECT 1 FROM public.staking_deals WHERE id='${deal}');END $$;
CREATE TEMP TABLE local552_result(value jsonb);
CREATE FUNCTION pg_temp.funding552_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('vinpoker.funding552_fault',true)='skip' AND TG_TABLE_NAME='staking_deals' THEN RETURN NULL;END IF;
 IF current_setting('vinpoker.funding552_fault',true)=TG_TABLE_NAME
 AND (TG_TABLE_NAME<>'staking_audit_logs' OR to_jsonb(NEW)->>'action'='funded') THEN RAISE EXCEPTION 'LOCAL552_NATIVE_FAULT';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER local552_l BEFORE INSERT ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.funding552_fault();
CREATE TRIGGER local552_d BEFORE UPDATE ON public.staking_deals FOR EACH ROW EXECUTE FUNCTION pg_temp.funding552_fault();
CREATE TRIGGER local552_a BEFORE INSERT ON public.staking_audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.funding552_fault();
CREATE TRIGGER local552_r BEFORE INSERT ON public.staking_legacy_funding_receipts_v1 FOR EACH ROW EXECUTE FUNCTION pg_temp.funding552_fault();
INSERT INTO public.user_roles(user_id,role) SELECT '${actor}','super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${actor}' AND role='super_admin');
INSERT INTO public.staking_deals(id,player_id,backer_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
SELECT '${deal}','${actor}','${actor}',id,'LOCAL552 actual legacy handler rollback',now(),'LOCAL ONLY',10,1,1000000,'committed' FROM public.clubs ORDER BY id LIMIT 1;
SET LOCAL vinpoker.funding552_fault='${stage}';
DO $$ DECLARE receipt jsonb;packet jsonb;BEGIN
 PERFORM set_config('role','service_role',true);
 BEGIN
  receipt:=public.commit_staking_legacy_funding_v1('${actor}','${deal}','LOCAL552',100000,'https://local.invalid/proof','LOCAL TEST');
  packet:=jsonb_build_object('data',receipt,'error',NULL);
 EXCEPTION WHEN OTHERS THEN
  IF '${stage}'='skip' THEN ASSERT SQLERRM='staking_legacy_funding_write_unverified';ELSE ASSERT SQLERRM='LOCAL552_NATIVE_FAULT';END IF;
  packet:=jsonb_build_object('data',NULL,'error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM));
 END;
 PERFORM set_config('role','postgres',true);
 IF '${stage}'='success' THEN
  ASSERT receipt=jsonb_build_object('success',true,'deal_id','${deal}'::uuid,'status','locked');
  ASSERT (SELECT status='locked' FROM public.staking_deals WHERE id='${deal}');
  ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='fund_lock');
  ASSERT (SELECT count(*)=1 FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='funded');
  ASSERT (SELECT count(*)=1 FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id='${deal}');
 ELSE
  ASSERT packet->'data'='null'::jsonb;
  ASSERT (SELECT status='committed' FROM public.staking_deals WHERE id='${deal}');
  ASSERT NOT EXISTS(SELECT 1 FROM public.escrow_transactions WHERE deal_id='${deal}');
  ASSERT NOT EXISTS(SELECT 1 FROM public.staking_audit_logs WHERE deal_id='${deal}' AND action='funded');
  ASSERT NOT EXISTS(SELECT 1 FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id='${deal}');
 END IF;
 INSERT INTO local552_result VALUES(packet);
END $$;
SELECT value FROM local552_result;ROLLBACK;
DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.staking_deals WHERE id='${deal}');END $$;`;
  const output=execFileSync('wsl.exe',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
   'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000});
  return JSON.parse(output.trim());
 });
 const roleQuery={select:()=>roleQuery,eq:()=>roleQuery,maybeSingle:async()=>({data:{role:'super_admin'},error:null})};
 const createAdminClient=vi.fn(()=>({rpc,from:()=>roleQuery}));
 const source=readFileSync('supabase/functions/staking-confirm-funded/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status}),
  createAdminClient,authenticateUser:async()=>({uid:actor}),parseBody:async(req:Request,schema:z.ZodType)=>({ok:true,data:schema.parse(await req.json())}),Deno:{serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/legacy-funded',{method:'POST',body:JSON.stringify({deal_id:deal,bank_tx_id:'LOCAL552',amount_vnd:100000,proof_image_url:'https://local.invalid/proof',note:'LOCAL TEST'})}));
 const body=await response.json();
 if(stage==='success'){expect(response.status).toBe(200);expect(body).toEqual({success:true,deal_id:deal,status:'locked'});}
 else{expect(response.status).toBe(stage==='skip'?409:500);expect(body.success).not.toBe(true);}
 expect(rpc).toHaveBeenCalledTimes(1);expect(createAdminClient).toHaveBeenCalledWith({retry:false});
});
