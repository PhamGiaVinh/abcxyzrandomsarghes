// Actual handler/consumer/native RPCs, Auth and provider TEST sinks; no COMMIT.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {drainStakingFundingEmails,parseFundingEmailStatus} from '../../supabase/functions/_shared/stakingFundingEffects.ts';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',deal=randomUUID(),purchase=randomUUID(),quote=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let output='',pending=null,ended=false,queue=Promise.resolve(),diagnostics='',sends=0,unknownSend=false;
const closed=new Promise(resolve=>child.once('close',code=>{ended=true;pending?.reject(Error(`native closed ${code}: ${diagnostics}`));resolve(code);}));
child.on('error',e=>pending?.reject(e));child.stderr.on('data',c=>{diagnostics+=c.toString();});
child.stdout.on('data',c=>{output+=c.toString();if(!pending||!output.includes(pending.marker+'\n'))return;
 const i=output.indexOf(pending.marker+'\n'),job=pending,lines=output.slice(0,i).trim().split('\n').filter(Boolean);output=output.slice(i+job.marker.length+1);pending=null;clearTimeout(job.timer);
 try{assert.equal(lines.length,1);job.resolve(JSON.parse(lines[0]));}catch(e){job.reject(e);}});
function execute(sql){const next=queue.then(()=>new Promise((resolve,reject)=>{assert.equal(ended,false);const marker=`FUNDING547_${randomUUID()}`;
 const timer=setTimeout(()=>{reject(Error('native query deadline'));child.stdin.end('ROLLBACK;\n\\q\n');},15000);pending={marker,resolve,reject,timer};child.stdin.write(`${sql}\n\\echo ${marker}\n`);
}));queue=next.catch(()=>{});return next;}
const names={commit_staking_funding_v1:['p_actor','p_purchase','p_bank_tx','p_note'],claim_staking_funding_email_v1:['p_actor','p_purchase'],
 finish_staking_funding_email_v1:['p_actor','p_purchase','p_id','p_token','p_provider_id','p_error_code'],get_staking_funding_email_status_v1:['p_actor','p_purchase']};
const admin={rpc:async(name,args)=>{assert.ok(names[name]);assert.equal(args.p_actor,actor);assert.equal(args.p_purchase,purchase);
 return execute(`RESET ROLE;DO $$ DECLARE value jsonb;BEGIN PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('role','service_role',true);
 BEGIN SELECT to_jsonb(public.${name}(${names[name].map(k=>quote(args[k])).join(',')})) INTO value;
 PERFORM set_config('vinpoker.funding547_rpc',jsonb_build_object('data',value,'error',NULL)::text,true);
 EXCEPTION WHEN OTHERS THEN PERFORM set_config('vinpoker.funding547_rpc',jsonb_build_object('data',NULL,'error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM))::text,true);END;
 PERFORM set_config('role','postgres',true);END $$;SELECT current_setting('vinpoker.funding547_rpc')::jsonb;`);},
 auth:{admin:{getUserById:async id=>{assert.equal(id,actor);return {data:{user:{email:'local547@example.invalid'}},error:null};}}},
 functions:{invoke:async(name,options)=>{assert.equal(name,'send-email');assert.equal(options.body.to,'local547@example.invalid');sends++;
  if(unknownSend&&sends===2)throw Error('LOCAL_SEND_RESULT_UNKNOWN');return {data:{success:true,id:`LOCAL547_ACK_${sends}`},error:null};}}};
let handler;const source=readFileSync('supabase/functions/admin-confirm-funded/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 Request,Response,z,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),authenticateUser:async()=>({uid:actor}),requireAdminRoles:async()=>({isSuper:true,isCashier:false}),
 createAdminClient:options=>{assert.equal(options.retry,false);return admin;},drainStakingFundingEmails,parseFundingEmailStatus,
 parseBody:async(req,schema)=>({ok:true,data:schema.parse(await req.json())}),Deno:{serve:fn=>{handler=fn;}}});
const call=(note='LOCAL547',bank='LOCAL_BANK')=>handler(new Request('http://local.invalid/funded',{method:'POST',body:JSON.stringify({purchase_id:purchase,bank_tx_id:bank,note})}));
try{
 await execute(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='2min';
 DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));END $$;
 INSERT INTO public.user_roles(user_id,role) SELECT '${actor}','super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${actor}' AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 SELECT '${deal}','${actor}',id,'LOCAL547 funding handler rollback',now(),'LOCAL ONLY',10,1,1000000,'committed' FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 VALUES('${purchase}','${deal}','${actor}',10,1,100000,'committed','LOCAL547');SAVEPOINT complete_branch;SELECT '{}'::jsonb;`);
 const first=await call();assert.equal(first.status,200);const a=await first.json();assert.equal(a.purchase_status,'funded');assert.equal(a.deal_status,'funded');
 assert.equal(a.delivery.state,'all_delivered');assert.equal(a.delivery.delivered,2);assert.equal(sends,2);
 const replay=await call();assert.equal(replay.status,200);assert.deepEqual((await replay.json()).delivery,a.delivery);assert.equal(sends,2);
 console.log('FUNDING547_ACTUAL_HANDLER_NATIVE_TWO_ROLE_DELIVERY_REPLAY_PASS');
 await execute(`ROLLBACK TO SAVEPOINT complete_branch;RELEASE SAVEPOINT complete_branch;SELECT '{}'::jsonb;`);unknownSend=true;sends=0;
 const uncertain=await call();assert.equal(uncertain.status,200);const b=await uncertain.json();assert.equal(b.delivery.state,'needs_attention');
 assert.equal(b.delivery.delivered,1);assert.equal(b.delivery.needs_attention,1);
 const heldReplay=await call();assert.equal(heldReplay.status,200);assert.deepEqual((await heldReplay.json()).delivery,b.delivery);assert.equal(sends,2);
 assert.equal((await call('CHANGED')).status,409);assert.equal((await call('LOCAL547','OTHER_BANK')).status,409);assert.equal(sends,2);
 const facts=await execute(`RESET ROLE;SELECT jsonb_build_object('funds',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='fund_lock'),
 'amount',(SELECT sum(amount_vnd) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='fund_lock'),
 'receipts',(SELECT count(*) FROM public.staking_funding_receipts_v1 WHERE purchase_id='${purchase}'),'emails',(SELECT count(*) FROM public.staking_funding_email_intents_v1 WHERE purchase_id='${purchase}'));`);
 assert.deepEqual(facts,{funds:1,amount:100000,receipts:1,emails:2});
 await execute(`SET LOCAL ROLE service_role;SELECT public.commit_staking_refund_v1('${actor}','${randomUUID()}','${deal}','LOCAL547 conservation');`);
 const balance=await execute(`RESET ROLE;SELECT jsonb_build_object('fund',sum(amount_vnd) FILTER(WHERE transaction_type='fund_lock'),
 'refund',sum(amount_vnd) FILTER(WHERE transaction_type='refund')) FROM public.escrow_transactions WHERE deal_id='${deal}';`);
 assert.deepEqual(balance,{fund:100000,refund:100000});assert.equal(sends,2);
 console.log('FUNDING547_NATIVE_UNKNOWN_HELD_PAYLOAD_CONFLICT_NO_EXTRA_MONEY_SINK_REFUND_CONSERVATION_PASS',JSON.stringify(facts));
}finally{
 if(!ended){await execute(`RESET ROLE;ROLLBACK;SELECT jsonb_build_object('purchase',(SELECT count(*) FROM public.staking_purchases WHERE id='${purchase}'),'deal',(SELECT count(*) FROM public.staking_deals WHERE id='${deal}'));`).then(v=>assert.deepEqual(v,{purchase:0,deal:0}));child.stdin.end('\\q\n');}
 assert.equal(await closed,0);console.log('FUNDING547_FULL_ROLLBACK_NO_REAL_PROVIDER_PASS');
}
