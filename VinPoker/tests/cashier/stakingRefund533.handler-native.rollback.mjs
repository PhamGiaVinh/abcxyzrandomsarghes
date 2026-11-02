// Actual handler + consumer + native RPCs; Auth/provider are TEST sinks. No COMMIT.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {drainStakingRefundEmails,parseRefundEmailStatus} from '../../supabase/functions/_shared/stakingRefundEffects.ts';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',deal=randomUUID(),request=randomUUID();
const quote=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
 'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
let output='',pending=null,ended=false,diagnostics='',queue=Promise.resolve();
const closed=new Promise(resolve=>child.once('close',code=>{ended=true;pending?.reject(Error(`native closed ${code}: ${diagnostics}`));resolve(code);}));
child.on('error',error=>pending?.reject(error));child.stderr.on('data',c=>{diagnostics+=c.toString();});
child.stdout.on('data',c=>{output+=c.toString();if(!pending||!output.includes(pending.marker+'\n'))return;
 const i=output.indexOf(pending.marker+'\n'),job=pending,lines=output.slice(0,i).trim().split('\n').filter(Boolean);
 output=output.slice(i+job.marker.length+1);pending=null;clearTimeout(job.timer);
 try{assert.equal(lines.length,1);job.resolve(JSON.parse(lines[0]));}catch(error){job.reject(error);}});
function execute(sql){const next=queue.then(()=>new Promise((resolve,reject)=>{
 assert.equal(ended,false);const marker=`REFUND533_${randomUUID()}`;
 const timer=setTimeout(()=>{reject(Error('native query deadline'));child.stdin.end('ROLLBACK;\n\\q\n');},15000);
 pending={marker,resolve,reject,timer};child.stdin.write(`${sql}\n\\echo ${marker}\n`);
}));queue=next.catch(()=>{});return next;}
const order={commit_staking_refund_v1:['p_actor','p_request','p_deal','p_reason'],claim_staking_refund_email_v1:['p_actor','p_request'],
 finish_staking_refund_email_v1:['p_actor','p_request','p_id','p_token','p_provider_id','p_error_code'],get_staking_refund_email_status_v1:['p_actor','p_request']};
let sends=0,unknownSend=true;
const admin={rpc:async(name,args)=>{
 assert.ok(order[name]);assert.equal(args.p_actor,actor);assert.equal(args.p_request,request);
 const expression=`public.${name}(${order[name].map(k=>quote(args[k])).join(',')})`;
 return execute(`RESET ROLE;DO $$ DECLARE value jsonb;BEGIN PERFORM set_config('role','service_role',true);
 BEGIN SELECT to_jsonb(${expression}) INTO value;
 PERFORM set_config('vinpoker.refund533_rpc',jsonb_build_object('data',value,'error',NULL)::text,true);
 EXCEPTION WHEN OTHERS THEN PERFORM set_config('vinpoker.refund533_rpc',jsonb_build_object('data',NULL,'error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM))::text,true);END;
 PERFORM set_config('role','postgres',true);END $$;SELECT current_setting('vinpoker.refund533_rpc')::jsonb;`);
 },auth:{admin:{getUserById:async id=>{assert.equal(id,actor);return {data:{user:{email:'local533-sink@example.invalid'}},error:null};}}},
 functions:{invoke:async(name,options)=>{assert.equal(name,'send-email');assert.equal(options.body.to,'local533-sink@example.invalid');
  sends++;if(unknownSend&&sends===2)throw Error('LOCAL_UNKNOWN_SEND_AFTER_SINK');return {data:{success:true,id:`LOCAL533_ACK_${sends}`},error:null};}}};
let handler;const source=readFileSync('supabase/functions/staking-process-refund/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 Request,Response,z,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
 authenticateUser:async()=>({uid:actor}),requireAdminRoles:async()=>({isSuper:true,isCashier:false}),createAdminClient:options=>{assert.equal(options.retry,false);return admin;},
 drainStakingRefundEmails,parseRefundEmailStatus,parseBody:async(req,schema)=>({ok:true,data:schema.parse(await req.json())}),Deno:{serve:fn=>{handler=fn;}}});
const call=reason=>handler(new Request('http://local.invalid/refund',{method:'POST',body:JSON.stringify({deal_id:deal,request_id:request,reason})}));
try{
 await execute(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='2min';
 DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));END $$;
 INSERT INTO public.user_roles(user_id,role) SELECT '${actor}','super_admin' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${actor}' AND role='super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 SELECT '${deal}','${actor}',id,'LOCAL533 handler rollback',now(),'LOCAL ONLY',10,1,1000000,'funded' FROM public.clubs ORDER BY id LIMIT 1;
 INSERT INTO public.staking_purchases(deal_id,backer_id,percent,markup,amount_vnd,status,reference_code)
 SELECT '${deal}','${actor}',5,1,amount,'funded',gen_random_uuid()::text FROM unnest(ARRAY[50000,60000]) amount;
 SELECT '{}'::jsonb;`);
 await execute(`SAVEPOINT complete_branch;SELECT '{}'::jsonb;`);
 unknownSend=false;
 const completeResponse=await call('LOCAL533');assert.equal(completeResponse.status,200);const complete=await completeResponse.json();
 assert.equal(complete.success,true);assert.equal(complete.delivery.state,'all_delivered');assert.equal(complete.delivery.expected,2);
 assert.equal(complete.delivery.total,2);assert.equal(complete.delivery.delivered,2);assert.equal(complete.delivery.needs_attention,0);assert.equal(sends,2);
 const completeReplay=await call('LOCAL533');assert.equal(completeReplay.status,200);
 assert.deepEqual((await completeReplay.json()).delivery,complete.delivery);assert.equal(sends,2);
 console.log('REFUND536_NATIVE_ALL_DELIVERED_EXACT_REPLAY_NO_EXTRA_SINK_PASS');
 await execute(`ROLLBACK TO SAVEPOINT complete_branch;RELEASE SAVEPOINT complete_branch;SELECT '{}'::jsonb;`);
 // Separate rollback-only branch, not a reset of a real provider or committed history.
 unknownSend=true;sends=0;
 const first=await call('LOCAL533');assert.equal(first.status,200);const a=await first.json();
 assert.equal(a.success,true);assert.equal(a.refunded_backers,2);assert.equal(a.delivery.state,'needs_attention');
 assert.equal(a.delivery.delivered,1);assert.equal(a.delivery.needs_attention,1);assert.equal(sends,2);
 const replay=await call('LOCAL533');assert.equal(replay.status,200);const b=await replay.json();
 assert.deepEqual(b.delivery,a.delivery);assert.equal(sends,2);assert.equal(b.effects.state,'no_pending');
 const conflict=await call('CHANGED');assert.equal(conflict.status,409);assert.equal(sends,2);
 const facts=await execute(`RESET ROLE;SELECT jsonb_build_object('status',(SELECT status FROM public.staking_deals WHERE id='${deal}'),
 'refunds',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='refund'),
 'amount',(SELECT sum(amount_vnd) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='refund'),
 'receipts',(SELECT count(*) FROM public.staking_refund_receipts_v1 WHERE deal_id='${deal}'),
 'emails',(SELECT count(*) FROM public.staking_refund_email_intents_v1 WHERE deal_id='${deal}'));`);
 assert.deepEqual(facts,{status:'deal_refunded',refunds:2,amount:110000,receipts:1,emails:2});
 console.log('REFUND533_ACTUAL_HANDLER_NATIVE_CONSUMER_SINK_REPLAY_CONFLICT_HELD_UNKNOWN_PASS',JSON.stringify(facts));
}finally{
 if(!ended){await execute(`ROLLBACK;SELECT jsonb_build_object('purchases',(SELECT count(*) FROM public.staking_purchases WHERE deal_id='${deal}'),
 'receipts',(SELECT count(*) FROM public.staking_refund_receipts_v1 WHERE deal_id='${deal}'));`).then(v=>assert.deepEqual(v,{purchases:0,receipts:0}));child.stdin.end('\\q\n');}
 assert.equal(await closed,0);console.log('REFUND533_FULL_ROLLBACK_NO_PROVIDER_PASS');
}
