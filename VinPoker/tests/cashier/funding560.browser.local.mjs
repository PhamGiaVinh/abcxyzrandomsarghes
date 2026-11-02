import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {drainStakingFundingEmails,parseFundingEmailStatus} from '../../supabase/functions/_shared/stakingFundingEffects.ts';

// Actual funding handler/consumer/SQL, rollback-only; HTTP/Auth/provider modeled.
export async function createFunding560Browser({actor,club,log}){
 assert.equal(process.env.VINPOKER_FUNDING560_BROWSER,'1');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');assert.equal(club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 const loss565=process.env.VINPOKER_FUNDING565_LOSS==='1';
 const admin567=process.env.VINPOKER_FUNDING567_ADMIN==='1';
 const archive574=process.env.VINPOKER_ARCHIVE574_BROWSER==='1';assert.ok(!archive574||(!loss565&&!admin567));
 const deal=archive574?'e5740000-0000-4000-8000-000000000001':admin567?'e5670000-0000-4000-8000-000000000001':loss565?'e5650000-0000-4000-8000-000000000001':'e5600000-0000-4000-8000-000000000001';
 const purchase=admin567?'e5670000-0000-4000-8000-000000000002':loss565?'e5650000-0000-4000-8000-000000000002':'e5600000-0000-4000-8000-000000000002';
 const reference=archive574?'LOCAL574':admin567?'LOCAL567':loss565?'LOCAL565':'LOCAL560';
 const quote=v=>v==null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',pending=null,ended=false,queue=Promise.resolve(),diagnostics='',sends=0;
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;pending?.reject(Error(`funding fixture closed ${code}: ${diagnostics}`));resolve(code);}));
 child.on('error',e=>pending?.reject(e));child.stderr.on('data',c=>{diagnostics+=c.toString();});
 child.stdout.on('data',c=>{output+=c.toString();if(!pending||!output.includes(pending.marker+'\n'))return;
  const i=output.indexOf(pending.marker+'\n'),job=pending,lines=output.slice(0,i).trim().split('\n').filter(Boolean);
  output=output.slice(i+job.marker.length+1);pending=null;clearTimeout(job.timer);
  try{assert.equal(lines.length,1);job.resolve(JSON.parse(lines[0]));}catch(e){job.reject(e);}});
 function execute(statement){const next=queue.then(()=>new Promise((resolve,reject)=>{assert.equal(ended,false);const marker=`FUNDING560_${randomUUID()}`;
  const timer=setTimeout(()=>{reject(Error('native query deadline'));child.stdin.end('ROLLBACK;\n\\q\n');},15000);
  pending={marker,resolve,reject,timer};child.stdin.write(`${statement}\n\\echo ${marker}\n`);
 }));queue=next.catch(()=>{});return next;}
 const snapshot=`SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.user_roles x),
 'cashiers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.club_cashiers x),
 'auth_usage',has_schema_privilege('authenticated','auth','USAGE'));`;
 const before=await execute(snapshot);
 try{await execute(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10min';
 DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.clubs WHERE id='${club}' AND owner_id='${actor}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.staking_deals WHERE id='${deal}');END $$;
 INSERT INTO public.user_roles(user_id,role) SELECT '${actor}','${archive574?'super_admin':'cashier'}' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${actor}' AND role='${archive574?'super_admin':'cashier'}');
 INSERT INTO public.club_cashiers(user_id,club_id) SELECT '${actor}','${club}' WHERE NOT EXISTS(SELECT 1 FROM public.club_cashiers WHERE user_id='${actor}' AND club_id='${club}');
 GRANT USAGE ON SCHEMA auth TO authenticated;
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 VALUES('${deal}','${actor}','${club}','${reference} rollback TEST',now(),'LOCAL ONLY',10,1,1000000,'${archive574?'listing':'committed'}','${archive574?'rejected':'pending'}');
 ${archive574?'':`INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code,committed_at)
 VALUES('${purchase}','${deal}','${actor}',10,1,100000,'committed','${reference}',now());`}SELECT '{}'::jsonb;`);
 }catch(error){if(!ended)child.stdin.end('ROLLBACK;\n\\q\n');await closed;throw error;}
 const names={commit_staking_funding_v1:['p_actor','p_purchase','p_bank_tx','p_note'],claim_staking_funding_email_v1:['p_actor','p_purchase'],
  finish_staking_funding_email_v1:['p_actor','p_purchase','p_id','p_token','p_provider_id','p_error_code'],get_staking_funding_email_status_v1:['p_actor','p_purchase'],get_staking_funding_receipt_v1:['p_actor','p_purchase'],
  archive_staking_listing_v1:['p_actor','p_deal','p_expected_review'],get_staking_listing_archive_receipt_v1:['p_actor','p_deal','p_expected_review']};
 const admin={rpc:async(name,args)=>{assert.ok(names[name]);assert.equal(args.p_actor,actor);
  if(archive574){assert.ok(['archive_staking_listing_v1','get_staking_listing_archive_receipt_v1'].includes(name));assert.equal(args.p_deal,deal);assert.equal(args.p_expected_review,'rejected');}else assert.equal(args.p_purchase,purchase);
  return execute(`RESET ROLE;DO $$ DECLARE value jsonb;BEGIN PERFORM set_config('request.jwt.claim.sub','',true);PERFORM set_config('role','service_role',true);
   BEGIN SELECT to_jsonb(public.${name}(${names[name].map(k=>quote(args[k])).join(',')})) INTO value;
   PERFORM set_config('vinpoker.funding560_rpc',jsonb_build_object('data',value,'error',NULL)::text,true);
   EXCEPTION WHEN OTHERS THEN PERFORM set_config('vinpoker.funding560_rpc',jsonb_build_object('data',NULL,'error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM))::text,true);END;
   PERFORM set_config('role','postgres',true);END $$;SELECT current_setting('vinpoker.funding560_rpc')::jsonb;`);},
  auth:{admin:{getUserById:async id=>{assert.equal(id,actor);return {data:{user:{email:'funding560@example.invalid'}},error:null};}}},
  functions:{invoke:async(name,options)=>{assert.equal(name,'send-email');assert.equal(options.body.to,'funding560@example.invalid');sends++;
   if(sends===2)throw Error('LOCAL560_PROVIDER_OUTCOME_UNKNOWN');return {data:{success:true,id:`LOCAL560_ACK_${sends}`},error:null};}}};
 let handler,statusHandler;const source=readFileSync('supabase/functions/admin-confirm-funded/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),authenticateUser:async()=>({uid:actor}),
  requireAdminRoles:async()=>({isSuper:false,isCashier:true}),createAdminClient:options=>{assert.equal(options.retry,false);return admin;},drainStakingFundingEmails,parseFundingEmailStatus,
  parseBody:async(req,schema)=>{const p=schema.safeParse(await req.json());return p.success?{ok:true,data:p.data}:{ok:false,response:new Response('{}',{status:400})};},Deno:{serve:fn=>{handler=fn;}}});
 const statusSource=readFileSync('supabase/functions/admin-staking-funding-status/index.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
 runInNewContext(ts.transpileModule(statusSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,z,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),authenticateUser:async()=>({uid:actor}),
  requireAdminRoles:async()=>({isSuper:false,isCashier:true}),createAdminClient:options=>{assert.equal(options.retry,false);return admin;},parseFundingEmailStatus,
  parseBody:async(req,schema)=>{const p=schema.safeParse(await req.json());return p.success?{ok:true,data:p.data}:{ok:false,response:new Response('{}',{status:400})};},Deno:{serve:fn=>{statusHandler=fn;}}});
 const authenticated=`RESET ROLE;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
 const archiveAuditBefore=archive574?await execute(`SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id='${deal}';`):null;
 const archiveNotificationsBefore=archive574?await execute('SELECT to_jsonb(count(*)) FROM public.notifications;'):null;
 const archiveHandlers={};
 if(archive574)for(const path of ['admin-archive-staking-listing','admin-staking-listing-archive-status']){
  const text=readFileSync(`supabase/functions/${path}/index.ts`,'utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
  runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
   Request,Response,z,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),authenticateUser:async()=>({uid:actor}),
   requireAdminRoles:async()=>({isSuper:true,isCashier:false}),createAdminClient:options=>{assert.equal(options.retry,false);return admin;},
   parseBody:async(req,schema)=>{const p=schema.safeParse(await req.json());return p.success?{ok:true,data:p.data}:{ok:false,response:new Response('{}',{status:400})};},Deno:{serve:fn=>{archiveHandlers[path]=fn;}}});
 }
 let archiveCalls=0;
 return {manifest:{deal,purchase,admin:admin567,reviewArchive:archive574},async route(url,method,body){
  if(archive574&&url.pathname==='/rest/v1/staking_deals'&&method==='GET'){
   assert.equal(url.searchParams.get('status'),'eq.listing');const review=url.searchParams.get('admin_review_status');assert.ok(['eq.pending','eq.approved','eq.rejected'].includes(review));
   return {status:200,value:await execute(`${authenticated}SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.staking_deals x WHERE id='${deal}' AND status='listing' AND admin_review_status=${quote(review.slice(3))};RESET ROLE;SET LOCAL request.jwt.claim.sub='';`)};
  }
  if(archive574&&url.pathname.startsWith('/functions/v1/')){
   const path=url.pathname.split('/').at(-1);assert.ok(archiveHandlers[path]);assert.equal(method,'POST');assert.deepEqual(body,{deal_id:deal,expected_review:'rejected'});
   const response=await archiveHandlers[path](new Request('http://local.invalid/archive',{method:'POST',body:JSON.stringify(body)}));const value=await response.json();
   const isWrite=path==='admin-archive-staking-listing';if(isWrite)archiveCalls++;
   const dropped=isWrite&&response.status===200;log.push({archive574:{operation:isWrite?'archive':'read',deal,status:response.status,responseDropped:dropped}});
   return dropped?{status:503,value:{error:'LOCAL574_RESPONSE_LOST_AFTER_ARCHIVE'}}:{status:response.status,value};
  }
  if(archive574&&url.pathname==='/rest/v1/staking_purchases')throw Error('Archive UI must not count/delete purchases on the client');
  if(url.pathname==='/rest/v1/staking_purchases'&&method==='GET'){
   assert.equal(url.searchParams.get('status'),'eq.committed');if(!admin567)assert.equal(url.searchParams.get('deal.club_id'),`in.(${club})`);
   return {status:200,value:await execute(`${authenticated}SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('deal',to_jsonb(d))),'[]'::jsonb)
    FROM public.staking_purchases p JOIN public.staking_deals d ON d.id=p.deal_id WHERE p.id='${purchase}' AND p.status='committed';RESET ROLE;SET LOCAL request.jwt.claim.sub='';`)};
  }
  if(admin567&&url.pathname==='/rest/v1/staking_deals'&&method==='GET'){
   assert.equal(url.searchParams.get('id'),`in.(${deal})`);
   return {status:200,value:await execute(`${authenticated}SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'club_id',club_id,'player_id',player_id,
    'percentage_sold',percentage_sold,'filled_percent',filled_percent,'early_closed',early_closed,'status',status,'custom_event_name',custom_event_name,'tournament_id',tournament_id)),'[]'::jsonb)
    FROM public.staking_deals WHERE id='${deal}';RESET ROLE;SET LOCAL request.jwt.claim.sub='';`)};
  }
  if(url.pathname==='/rest/v1/profiles'&&method==='GET'&&url.searchParams.has('user_id')){
   assert.equal(url.searchParams.get('user_id'),`in.(${actor})`);
   return {status:200,value:await execute(`${authenticated}SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name)),'[]'::jsonb)
    FROM public.profiles WHERE user_id='${actor}';RESET ROLE;SET LOCAL request.jwt.claim.sub='';`)};
  }
  const isStatus=url.pathname==='/functions/v1/admin-staking-funding-status';
  if((url.pathname!=='/functions/v1/admin-confirm-funded'&&!isStatus)||method!=='POST')return null;
  assert.deepEqual(body,{purchase_id:purchase});
  const response=await (isStatus?statusHandler:handler)(new Request('http://local.invalid/funded',{method:'POST',body:JSON.stringify(body)})),value=await response.json();
  const responseDropped=loss565&&!isStatus&&response.status===200;
  log.push({funding560:{operation:isStatus?'read':'confirm',purchase,status:response.status,sends,delivery:value.delivery?.state,responseDropped}});
  if(responseDropped)return {status:503,value:{error:'LOCAL565_RESPONSE_LOST_AFTER_FUNDING_WRITE'}};
  return {status:response.status,value};
 },async cleanup(){
  assert.equal(ended,false,'fixture ended before rollback checks');
  try{
  if(archive574){
   assert.equal(sends,0);
   const facts=await execute(`RESET ROLE;SELECT jsonb_build_object('status',(SELECT status FROM public.staking_deals WHERE id='${deal}'),
    'receipts',(SELECT count(*) FROM public.staking_listing_archive_receipts_v1 WHERE deal_id='${deal}'),
    'archive_audits',(SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${deal}' AND metadata->>'operation'='archive_reviewed_listing'),
    'funds',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${deal}'),
    'purchases',(SELECT count(*) FROM public.staking_purchases WHERE deal_id='${deal}'));`);
   if(archiveCalls)assert.deepEqual(facts,{status:'cancelled',receipts:1,archive_audits:1,funds:0,purchases:0});
   assert.deepEqual(await execute(`SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE id IN(${archiveAuditBefore.map(x=>quote(x.id)).join(',')});`),archiveAuditBefore);
   assert.equal(await execute('SELECT to_jsonb(count(*)) FROM public.notifications;'),archiveNotificationsBefore);
   console.log('ARCHIVE574_NATIVE_FACTS_AUDIT_PRESERVED_NO_NOTIFICATIONS',JSON.stringify(facts));
  }else{
  const facts=await execute(`RESET ROLE;SELECT jsonb_build_object('funds',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='fund_lock'),
   'amount',(SELECT coalesce(sum(amount_vnd),0) FROM public.escrow_transactions WHERE deal_id='${deal}' AND transaction_type='fund_lock'),
   'receipts',(SELECT count(*) FROM public.staking_funding_receipts_v1 WHERE purchase_id='${purchase}'),
   'emails',(SELECT count(*) FROM public.staking_funding_email_intents_v1 WHERE purchase_id='${purchase}'),
   'delivered',(SELECT count(*) FROM public.staking_funding_email_intents_v1 WHERE purchase_id='${purchase}' AND state='delivered'),
   'attention',(SELECT count(*) FROM public.staking_funding_email_intents_v1 WHERE purchase_id='${purchase}' AND state='needs_attention'));`);
  if(sends>0)assert.deepEqual(facts,{funds:1,amount:100000,receipts:1,emails:2,delivered:1,attention:1});
  console.log('FUNDING560_NATIVE_FACTS_BEFORE_ROLLBACK',JSON.stringify({...facts,sends}));
  }
  }finally{
  try{
  await execute(`ROLLBACK;SELECT '{}'::jsonb;`);assert.deepEqual(await execute(snapshot),before);
  assert.deepEqual(await execute(`SELECT jsonb_build_object('deal',(SELECT count(*) FROM public.staking_deals WHERE id='${deal}'),'purchase',(SELECT count(*) FROM public.staking_purchases WHERE id='${purchase}'));`),{deal:0,purchase:0});
  }finally{child.stdin.end('\\q\n');assert.equal(await closed,0);}
  console.log('FUNDING560_FULL_ROLLBACK_ROLES_BINDINGS_AUTH_USAGE_UNCHANGED_PASS');
  }
 }};
}
