import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {drainStakingRefundEmails,parseRefundEmailStatus} from '../../supabase/functions/_shared/stakingRefundEffects.ts';

// Rollback-only fixture537. Existing gateway handles modeled browser authentication.
export async function createRefund538Browser({actor,club,log}){
 assert.equal(process.env.VINPOKER_REFUND538_BROWSER,'1');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');assert.equal(club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 const deal='e5370000-0000-4000-8000-000000000001',quote=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',pending=null,ended=false,queue=Promise.resolve(),diagnostics='',sends=0,held=null,drop=true;
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;pending?.reject(Error(`refund fixture closed ${code}: ${diagnostics}`));resolve(code);}));
 child.on('error',e=>pending?.reject(e));child.stderr.on('data',c=>{diagnostics+=c.toString();});
 child.stdout.on('data',c=>{output+=c.toString();if(!pending||!output.includes(pending.marker+'\n'))return;
  const i=output.indexOf(pending.marker+'\n'),job=pending,lines=output.slice(0,i).trim().split('\n').filter(Boolean);
  output=output.slice(i+job.marker.length+1);pending=null;clearTimeout(job.timer);
  try{assert.equal(lines.length,1);job.resolve(JSON.parse(lines[0]));}catch(e){job.reject(e);}});
 function execute(sql){const next=queue.then(()=>new Promise((resolve,reject)=>{assert.equal(ended,false);const marker=`REFUND538_${randomUUID()}`;
  const timer=setTimeout(()=>{reject(Error('native query deadline'));child.stdin.end('ROLLBACK;\n\\q\n');},15000);
  pending={marker,resolve,reject,timer};child.stdin.write(`${sql}\n\\echo ${marker}\n`);
 }));queue=next.catch(()=>{});return next;}
 const fixture=readFileSync('tests/cashier/refund537.fixture.rollback.sql','utf8'),begin=fixture.indexOf('\nBEGIN;'),end=fixture.indexOf('\nSET LOCAL ROLE service_role;');
 assert.ok(begin>0&&end>begin);const snapshot=fixture.slice(0,begin),before=await execute(snapshot);
 await execute(`${fixture.slice(begin,end)}\nSET LOCAL idle_in_transaction_session_timeout='10min';SELECT '{}'::jsonb;`);
 const names={commit_staking_refund_v1:['p_actor','p_request','p_deal','p_reason'],claim_staking_refund_email_v1:['p_actor','p_request'],finish_staking_refund_email_v1:['p_actor','p_request','p_id','p_token','p_provider_id','p_error_code'],get_staking_refund_email_status_v1:['p_actor','p_request']};
 const admin={rpc:async(name,args)=>{assert.ok(names[name]);assert.equal(args.p_actor,actor);
  return execute(`RESET ROLE;DO $$ DECLARE value jsonb;BEGIN PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('role','service_role',true);
  BEGIN SELECT to_jsonb(public.${name}(${names[name].map(k=>quote(args[k])).join(',')})) INTO value;
  PERFORM set_config('vinpoker.refund538_rpc',jsonb_build_object('data',value,'error',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN PERFORM set_config('vinpoker.refund538_rpc',jsonb_build_object('data',NULL,'error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM))::text,true);END;
  PERFORM set_config('role','postgres',true);END $$;SELECT current_setting('vinpoker.refund538_rpc')::jsonb;`);},
  auth:{admin:{getUserById:async id=>{assert.equal(id,actor);return {data:{user:{email:'refund538@example.invalid'}},error:null};}}},
  functions:{invoke:async(name,options)=>{assert.equal(name,'send-email');assert.equal(options.body.to,'refund538@example.invalid');sends++;return {data:{success:true,id:`LOCAL538_ACK_${sends}`},error:null};}}};
 let handler;const source=readFileSync('supabase/functions/staking-process-refund/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),authenticateUser:async()=>({uid:actor}),
  requireAdminRoles:async()=>({isSuper:false,isCashier:true}),createAdminClient:()=>admin,drainStakingRefundEmails,parseRefundEmailStatus,
  parseBody:async(req,schema)=>{const p=schema.safeParse(await req.json());return p.success?{ok:true,data:p.data}:{ok:false,response:new Response('{}',{status:400})};},Deno:{serve:fn=>{handler=fn;}}});
 return {manifest:{deal},release(){held?.();held=null;},async route(url,method,body){
  if(url.pathname==='/rest/v1/rpc/get_staking_refund_preview_v1'&&method==='POST'){
   assert.equal(body.p_deal,deal);return {status:200,value:await execute(`RESET ROLE;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
    SELECT public.get_staking_refund_preview_v1('${deal}');RESET ROLE;SET LOCAL request.jwt.claim.sub='';`)};
  }
  if(url.pathname==='/rest/v1/staking_deals'&&method==='GET')return {status:200,value:await execute(`RESET ROLE;SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('tournament',NULL)),'[]'::jsonb) FROM public.staking_deals d WHERE id='${deal}' AND status IN('funded','locked','result_entered','result_verified');`)};
  if(url.pathname==='/rest/v1/profiles'&&method==='GET'&&url.searchParams.has('user_id'))return {status:200,value:await execute(`RESET ROLE;SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name)),'[]'::jsonb) FROM public.profiles WHERE user_id='${actor}';`)};
  if(url.pathname!=='/functions/v1/staking-process-refund'||method!=='POST')return null;
  assert.equal(body.deal_id,deal);const response=await handler(new Request('http://local.invalid/refund',{method:'POST',body:JSON.stringify(body)})),value=await response.json();
  log.push({refund538:{request:body.request_id,status:response.status,sends,delivery:value.delivery?.state}});
  if(drop&&response.status===200){drop=false;log.push({refund538Held:true});await new Promise(resolve=>{held=resolve;});return {status:503,value:{error:'LOCAL538_RESPONSE_LOST_AFTER_NATIVE_RESULT'}};}
  return {status:response.status,value};
 },async cleanup(){held?.();if(!ended){const facts=await execute(`RESET ROLE;SELECT jsonb_build_object('refunds',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='refund'),
 'amount',(SELECT coalesce(sum(amount_vnd),0) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='refund'),
 'receipts',(SELECT count(*) FROM public.staking_refund_receipts_v1 WHERE deal_id='${deal}'),'emails',(SELECT count(*) FROM public.staking_refund_email_intents_v1 WHERE deal_id='${deal}'));`);
 if(sends>0)assert.deepEqual(facts,{refunds:2,amount:110000,receipts:1,emails:2});console.log('REFUND538_NATIVE_FACTS_BEFORE_ROLLBACK',JSON.stringify({...facts,sends}));
 await execute(`ROLLBACK;SELECT '{}'::jsonb;`);assert.deepEqual(await execute(snapshot),before);
  assert.equal(await execute(`SELECT to_jsonb(count(*)) FROM public.staking_deals WHERE id='${deal}';`),0);child.stdin.end('\\q\n');}
  assert.equal(await closed,0);console.log('REFUND538_FULL_ROLLBACK_ROLE_BINDINGS_UNCHANGED_PASS',JSON.stringify({sends}));}};
}
