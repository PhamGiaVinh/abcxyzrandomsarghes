import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {createServer} from 'node:http';

assert.equal(process.env.VINPOKER_CONFIG217_BROWSER,'1');
const fullGtdFixture=process.env.VINPOKER_CONFIG217_GTD_FIXTURE==='1';
const source='vinpoker_ops_cash115_qualified_c',scratch='vinpoker_config217_browser_20261021';
const marker='VINPOKER_LOCAL_CONFIG217_BROWSER_DISPOSABLE_20261021';
const origin='http://127.0.0.1:5188',endpoint='http://127.0.0.1:54330';
const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d',final='4cd3af4d-7e1d-4042-855f-04fb6777e580';
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const query=(db,input)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1',
 'PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
 {input,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const sql=input=>query(scratch,input);
const fingerprint=()=>query(source,`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 'prizes',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tournament_prizes m),
 'payments',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tournament_prize_payments m),
 'bank',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.bank_transactions m),
 'overlay',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.multi_day_overlay_funding_v1 m),
 'finalizations',(SELECT jsonb_agg(to_jsonb(m) ORDER BY event_id) FROM public.multi_day_payout_finalizations_v1 m),
 'gates',(SELECT jsonb_agg(to_jsonb(m)) FROM public.multi_day_package_release_v1 m),
 'guard',(SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure))::text);`);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
assert.equal(query(source,'SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.ok(Number(query(source,'SELECT pg_database_size(current_database());'))<256*1024*1024);
assert.equal(query(source,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(query('postgres',`SELECT count(*) FROM pg_database WHERE datname='${scratch}';`),'0');
const before=fingerprint(),signing=randomBytes(32),sessions=new Set(),audit=[];
let created=false,server,dropNext=false,stopping=false;
const user={id:actor,aud:'authenticated',role:'authenticated',email:'config217-owner@local.invalid',
 app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-10-21T00:00:00Z'};
const authSql=statement=>JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
 SET LOCAL ROLE authenticated;${statement}COMMIT;`));
function session(){
 const exp=Math.floor(Date.now()/1000)+3600;
 const unsigned=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'
  +Buffer.from(JSON.stringify({sub:actor,aud:'authenticated',role:'authenticated',exp,iat:exp-3600,iss:endpoint+'/auth/v1'})).toString('base64url');
 const token=unsigned+'.'+createHmac('sha256',signing).update(unsigned).digest('base64url');sessions.add(token);
 return {access_token:token,refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,expires_at:exp,user};
}
const definitions={
 multi_day_floor_read_v1:{p_event_id:'uuid'},multi_day_qualification_preview_v1:{p_event_id:'uuid'},
 multi_day_payout_preview_v1:{p_event_id:'uuid'},multi_day_final_roster_v1:{p_event_id:'uuid'},
 multi_day_payout_postfinal_state_v1:{p_event_id:'uuid'},
 multi_day_payout_configuration_preview_v1:{p_event_id:'uuid',p_proposed_rows:'jsonb'},
 multi_day_prize_configuration_receipt_v1:{p_event_id:'uuid',p_request_id:'uuid'},
 multi_day_save_prize_configuration_v1:{p_event_id:'uuid',p_rows:'jsonb',p_expected_configuration_revision:'text',
  p_expected_rules_version:'text',p_expected_funding_revision:'text',p_expected_qualification_revision:'text',
  p_expected_payout_input_hash:'text',p_request_id:'uuid',p_reason:'text'},
 ...(fullGtdFixture?{multi_day_finalize_payout_v1:{p_event_id:'uuid',p_expected_rules_version:'text',
  p_expected_funding_revision:'text',p_expected_qualification_revision:'text',p_expected_payout_input_hash:'text',p_request_id:'uuid'}}:{}),
};
function expression(name,args){
 const definition=definitions[name];assert.ok(definition,'endpoint_not_in_config217_canary');
 assert.deepEqual(Object.keys(args).sort(),Object.keys(definition).sort());assert.equal(args.p_event_id,event);
 return Object.entries(definition).map(([key,type])=>{
  const value=args[key];
  if(type==='uuid')assert.ok(uuid(value));
  else if(type==='jsonb')assert.ok(Array.isArray(value)&&value.length>0&&value.length<=100);
  else if(key==='p_reason')assert.ok(typeof value==='string'&&value.trim().length>0&&value.length<=500);
  else assert.ok(hash(value));
  return `${key}=>${quote(type==='jsonb'?JSON.stringify(value):value)}::${type}`;
 }).join(',');
}
async function stop(){
 if(stopping)return;stopping=true;
 if(server?.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 assert.equal(fingerprint(),before,'source changed while clone acceptance was running');
 if(created){
  assert.equal(query('postgres',`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${scratch}';`),marker);
  assert.equal(scratch,'vinpoker_config217_browser_20261021');assert.notEqual(scratch,source);
  query('postgres',`DROP DATABASE ${scratch};`);created=false;
 }
 console.log('CONFIG217_BROWSER_CLONE_REMOVED_SOURCE_PRESERVED_PASS');
}
try{
 query('postgres',`CREATE DATABASE ${scratch} TEMPLATE ${source};`);created=true;
 query('postgres',`COMMENT ON DATABASE ${scratch} IS '${marker}';`);
 sql(readFileSync(new URL('../../supabase/migrations/20270128000216_multiday_payout_configuration_preview_v1.sql',import.meta.url),'utf8')
  +readFileSync(new URL('../../supabase/migrations/20270128000217_multiday_prize_configuration_atomic_v1.sql',import.meta.url),'utf8'));
 sql(`UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
  GRANT USAGE ON SCHEMA auth TO authenticated;`);
 if(fullGtdFixture){
  // Explicit provider fixture ONLY in disposable clone, NOT evidence that a bank
  // transfer happened. Canonical overlay RPC still performs its real checks/write.
  assert.equal(sql(`SELECT count(*) FROM public.bank_transactions WHERE club_id='${club}';`),'0');
  assert.equal(sql(`SELECT guarantee_amount FROM public.tournament_events WHERE id='${event}';`),'2500000');
  sql(`INSERT INTO public.platform_bank_accounts(bank_name,account_number,account_holder,club_id,notes)
   VALUES('LOCAL SIMULATED BANK','LOCAL_GTD217_NOT_A_REAL_ACCOUNT','TEST fixture only','${club}',
    '${marker}: simulated verification, no external transfer');
   INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,
    transfer_type,content,status,api_verified_at,api_verified_source,raw_payload)
   VALUES('f07d27ae-d38f-4cc7-9d96-de26c02c7211','sepay','LOCAL_GTD217_SIMULATED_NOT_REAL',
    'LOCAL_GTD217_NOT_A_REAL_ACCOUNT','${club}',900000,'in','CLONE TEST GTD overlay',
    'unmatched',now(),'LOCAL_SIMULATED_PROVIDER_NOT_REAL',
    '{"localSimulation":true,"externalTransfer":false,"fixture":"GTD217"}'::jsonb);`);
  const args=`'${event}','RECORDED',900000,'LOCAL_GTD217_SIMULATED_NOT_REAL',
   'Owner TEST decision: club covers full shared GTD; provider proof simulated in clone only',
   NULL,NULL,'0a44ce78-5f3a-444d-b015-9e2b930c7211','f07d27ae-d38f-4cc7-9d96-de26c02c7211'`;
  const receipt=authSql(`SELECT public.multi_day_record_overlay_v1(${args});`);
  assert.equal(receipt.ok,true);assert.equal(receipt.idempotent,false);
  const replay=authSql(`SELECT public.multi_day_record_overlay_v1(${args});`);
  assert.equal(replay.recordId,receipt.recordId);assert.equal(replay.idempotent,true);
  audit.push({name:'multi_day_record_overlay_v1',requestId:'0a44ce78-5f3a-444d-b015-9e2b930c7211',
   state:receipt.status,eventId:event,providerEvidence:'SIMULATED_CLONE_ONLY',amountVnd:900000});
 }
 server=createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
  if(req.headers.host!=='127.0.0.1:54330'||req.headers.origin!==origin){send(403,{message:'local_origin_required'});return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile');
  res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{
   const path=new URL(req.url,endpoint).pathname;
   if(path==='/__local/session'&&req.method==='POST'){send(200,session());return;}
   const token=req.headers.authorization?.replace(/^Bearer /,'');
   if(!sessions.has(token)){send(401,{message:'local_authenticated_canary_only'});return;}
   if(path==='/auth/v1/user'&&req.method==='GET'){send(200,user);return;}
   if(path==='/__local/drop-next'&&req.method==='POST'){dropNext=true;send(200,{armed:true});return;}
   if(path==='/__local/evidence'&&req.method==='GET'){
    send(200,{model:'LOCAL_CLONE_AUTH_MODEL_REAL_PG',fundingModel:fullGtdFixture?'SIMULATED_PROVIDER_REAL_OVERLAY_RPC':'NO_OVERLAY',scratch,source,event,actor,audit,
     state:JSON.parse(sql(`SELECT jsonb_build_object('prizes',(SELECT count(*) FROM public.tournament_prizes WHERE tournament_id='${final}'),
     'payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${final}'),
     'recordedOverlayVnd',(SELECT coalesce(sum(CASE WHEN kind='REVERSAL' THEN -amount_vnd ELSE amount_vnd END),0) FROM public.multi_day_overlay_funding_v1 WHERE event_id='${event}'),
     'overlayRows',(SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE event_id='${event}'),
     'finalizations',(SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}'),
     'configurations',(SELECT count(*) FROM private.multi_day_prize_configurations_v1),
     'intents',(SELECT count(*) FROM private.multi_day_prize_write_intents_v1),
     'sourcePreserved',${quote(fingerprint())}=${quote(before)});`))});return;
   }
   assert.equal(req.method,'POST');const name=path.replace('/rest/v1/rpc/','');assert.equal(path,'/rest/v1/rpc/'+name);
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)throw Error('body_too_large');}
   const args=JSON.parse(raw||'{}'),call=expression(name,args);
   const result=authSql(`SELECT public.${name}(${call});`);
   audit.push({name,requestId:args.p_request_id??null,state:result.state??null,eventId:args.p_event_id});
   if(name==='multi_day_save_prize_configuration_v1'&&dropNext){
    dropNext=false;send(503,{code:'LOCAL_COMMIT_RECEIPT_LOST',message:'Commit receipt unavailable; retain original request and reconcile.'});return;
   }
   send(200,result);
  }catch(cause){
   const text=String(cause.stderr??cause.message),code=text.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
   send(code==='42501'?403:400,{code:code??'LOCAL_CANARY_REJECTED',message:text.match(/ERROR:[^\r\n]+/)?.[0]??'Local canary request rejected'});
  }
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54330,'127.0.0.1',resolve);});
 console.log(JSON.stringify({state:'CONFIG217_BROWSER_READY',endpoint,event,actor,scratch,fullGtdFixture,sourceFingerprint:before}));
 process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')stop().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exitCode=1;});});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exitCode=1;});});
}catch(error){await stop();throw error;}
