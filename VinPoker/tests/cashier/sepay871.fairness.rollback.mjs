// Current handler + native selector, injected settlement/provider transport.
// Existing service role only; no auth stub/role/grant/RLS changes. All SQL rolls back.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
assert.equal(process.env.VINPOKER_SEPAY871_LOCAL,'1');
const observationLoss=process.env.VINPOKER_SEPAY872_OBSERVATION_LOSS==='1';
const nativeObservationFault=process.env.VINPOKER_SEPAY890_NATIVE_OBSERVATION_FAULT==='1';
if(nativeObservationFault)assert.equal(observationLoss,true);
const nativeObservationErrors=[];
let observationBlocked=false;
const clone='vinpoker_ranking860_local',primary='vinpoker_ops_cash115_qualified_c';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,q)=>execFileSync('wsl',args(db),{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const protectedTables=['public.clubs','public.club_payment_config','public.bank_transactions','private.sepay_settlement_attempts','public.cashier_buyin_movements','public.tournament_entries','public.tournament_seats','public.tournament_prize_payments','public.game_tables','public.profiles','public.user_roles'];
const proof=db=>sql(db,`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';SELECT md5(jsonb_build_array(${protectedTables.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM ${t} r)`).join(',')},(SELECT count(*) FROM auth.users WHERE id='fa871000-0000-4000-8000-000000000010'),(SELECT md5(coalesce(string_agg(pg_get_triggerdef(oid),'' ORDER BY tgname),'')) FROM pg_trigger WHERE tgrelid='public.club_payment_config'::regclass),md5(pg_get_functiondef('auth.uid()'::regprocedure)),md5(pg_get_functiondef('public.sepay_take_settlement_batch_v1(uuid,integer)'::regprocedure)))::text);ROLLBACK;`);
const beforePrimary=proof(primary),beforeClone=proof(clone);
const club='fa871000-0000-4000-8000-000000000001',account='TEST871_LOCAL_ONLY';
const row=n=>`fa871000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const child=spawn('wsl',args(clone),{stdio:['pipe','pipe','pipe'],timeout:60000});let output='',errors='',terminal=false;
child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;resolve(code);});});
const until=async marker=>{const deadline=Date.now()+15000;while(!output.includes(marker)){assert.ok(!terminal,errors);assert.ok(Date.now()<deadline,'871 native observation deadline');await new Promise(r=>setTimeout(r,30));}};
let sequence=0,phaseError;
const native=async q=>{const start=output.length,marker='SEPAY871_REPLY_'+(++sequence);child.stdin.write(q+`;SELECT '${marker}';\n`);await until(marker);return JSON.parse(output.slice(start).split(/\r?\n/).find(s=>s.startsWith('[')||s.startsWith('{')));};
try{
 child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='3s';SET LOCAL idle_in_transaction_session_timeout='30s';
 DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.clubs WHERE id='${club}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.bank_transactions WHERE account_number='${account}');END $$;
 INSERT INTO auth.users(id) VALUES('fa871000-0000-4000-8000-000000000010');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','fa871000-0000-4000-8000-000000000010','SePay871 rollback TEST','TEST','approved');
 INSERT INTO public.club_payment_config(club_id,master_account_number,api_token_vault_key,is_active) VALUES('${club}','${account}','LOCAL871_NO_VAULT_SECRET',true);
 -- API-verified shape is synthetic preparation, not actual SePay verification.
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,api_verified_at,raw_payload)
 SELECT ('fa871000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'sepay','local871-'||n,'${account}',1,'in','UNMATCHED TEST871','unmatched',now(),'{}'::jsonb FROM generate_series(1,502)n;
 INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,api_verified_at,raw_payload) VALUES
 ('${row(601)}','sepay','local871-excluded-out','${account}',1,'out','EXCLUDED TEST871','unmatched',now(),'{}'),
 ('${row(602)}','sepay','local871-excluded-matched','${account}',1,'in','EXCLUDED TEST871','matched',now(),'{}'),
 ('${row(603)}','sepay','local871-excluded-unverified','${account}',1,'in','EXCLUDED TEST871','unmatched',NULL,'{}'),
 ('${row(604)}','sepay','local871-excluded-account','TEST871_OTHER',1,'in','EXCLUDED TEST871','unmatched',now(),'{}');
 ${nativeObservationFault?`CREATE FUNCTION pg_temp.sepay890_observation_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN IF NEW.club_id='${club}'::uuid THEN RAISE EXCEPTION 'LOCAL890_OBSERVABILITY_FAULT' USING ERRCODE='P0001';END IF;RETURN NEW;END $fault$;CREATE TRIGGER sepay890_observation_fault BEFORE UPDATE ON public.club_payment_config FOR EACH ROW EXECUTE FUNCTION pg_temp.sepay890_observation_fault();`:''}
 SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
 SELECT 'SEPAY871_READY';\n`);
 await until('SEPAY871_READY');
 const batches=[],processed=[],observations=[],logs=[];let handler;
 const admin={rpc:async(name,params)=>{
  if(name==='sepay_get_active_payment_clubs')return {data:[{club_id:club,master_account_number:account}],error:null};
  if(name==='sepay_get_club_api_token')return {data:'LOCAL871_MODEL_TOKEN',error:null};
  if(name==='sepay_claim_pull_v2')return {data:{status:'claimed',lease_token:'fa871000-0000-4000-8000-000000000900',window_from:'2026-10-25T00:00:00Z',window_to:'2026-10-26T00:00:00Z',next_page:1},error:null};
  if(name==='sepay_checkpoint_pull_v2')return {data:{ok:true,next_page:params.p_next_page,complete:params.p_complete},error:null};
  if(name==='sepay_take_settlement_batch_v1'){
   assert.equal(params.p_club_id,club);assert.equal(params.p_limit,500);
   const rows=await native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]'::jsonb) FROM public.sepay_take_settlement_batch_v1('${club}',500)`);
   assert.equal(rows.length,500);assert.equal(new Set(rows.map(r=>r.id)).size,500);assert.ok(rows.every(r=>Number(r.id.slice(-12))<=502));batches.push(rows.map(r=>r.id));return {data:rows,error:null};
  }
  if(name==='cashier_record_verified_bank_v1'){
   assert.ok(batches.at(-1).includes(params.p_bank_transaction_id));processed.push(params.p_bank_transaction_id);
   return {data:null,error:{message:'LOCAL871 persistent injected settlement transport failure'}};
  }
  if(name==='cashier_retry_paid_seating_v1')return {data:{ok:true,attempted:0,seated:0,needs_review:0},error:null};
  throw Error('871 unexpected RPC '+name);
 },from:table=>{
  assert.ok(['cashier_tour_settings','club_payment_config'].includes(table));let writing=false;
  const q={select:()=>q,eq:()=>q,update:value=>{writing=true;observations.push(value);return q;},maybeSingle:async()=>({data:{enabled:true},error:null}),then:(resolve,reject)=>Promise.resolve().then(async()=>{
   if(writing&&nativeObservationFault){
    const value=observations.at(-1);assert.equal(value.last_pull_status,'error');assert.equal(value.last_pull_error,'settlement_failed:500');
    const failure=await native(`DO $$DECLARE affected integer;BEGIN BEGIN UPDATE public.club_payment_config SET last_pull_status='error',last_pull_error='settlement_failed:500' WHERE club_id='${club}';GET DIAGNOSTICS affected=ROW_COUNT;IF affected=0 THEN PERFORM set_config('test.sepay890_error',jsonb_build_object('code','LOCAL890_UPDATE_ZERO_ROWS','message','existing native service role updated zero target rows')::text,true);ELSE RAISE EXCEPTION 'LOCAL890_FAULT_NOT_FIRED';END IF;EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'LOCAL890_OBSERVABILITY_FAULT' THEN RAISE;END IF;PERFORM set_config('test.sepay890_error',jsonb_build_object('code',SQLSTATE,'message',SQLERRM)::text,true);END;END $$;SELECT jsonb_build_object('data',NULL,'error',current_setting('test.sepay890_error')::jsonb)`);
    if(failure.error?.code==='LOCAL890_UPDATE_ZERO_ROWS'){observationBlocked=true;console.log('SEPAY890_NATIVE_OBSERVATION_BLOCKED_ZERO_TARGET_ROWS');return failure;}
    assert.deepEqual(failure.error,{code:'P0001',message:'LOCAL890_OBSERVABILITY_FAULT'});nativeObservationErrors.push(failure.error);return failure;
   }
   if(writing&&observationLoss)throw Error('LOCAL872 observation transport unavailable');
   return {data:writing?null:[],error:null};
  }).then(resolve,reject)};return q;
 }};
 const source=readFileSync('supabase/functions/sepay-reconcile/index.ts','utf8').replace(/import \{ createClient \} from "https:[^\n]+\n/,'').replace(/import \{ retryFetch \} from "[^\n]+\n/,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>admin,retryFetch:async url=>new Response(JSON.stringify(new URL(url).pathname==='/v2/bank-accounts'?{data:[{id:'fa871000-0000-4000-8000-000000000901',account_number:account,active:true}],meta:{pagination:{has_more:false}}}:{data:[],meta:{pagination:{total:0,has_more:false}}}),{status:200}),
  Deno:{env:{get:key=>({SUPABASE_URL:'http://local871.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL871_MODEL_KEY',SEPAY_RECONCILE_SECRET:'LOCAL871_MODEL_SECRET',SEPAY_AUTO_CONFIRM:'true'}[key])},serve:fn=>{handler=fn;}},
  Request,Response,TextEncoder,crypto:webcrypto,console:{error:(...args)=>logs.push(args)},Date,Uint8Array,
 });
 for(let tick=1;tick<=3;tick++){
  const response=await handler(new Request('http://local871.invalid/reconcile',{method:'POST',headers:{'X-Reconcile-Secret':'LOCAL871_MODEL_SECRET'}}));
  assert.equal(response.status,200);const result=await response.json();if(observationBlocked)throw new Error('SEPAY890_BLOCKED_NATIVE_UPDATE_ZERO_ROWS_SECURITY_WORK_EXCLUDED');assert.equal(result.ok,false);
  assert.equal(result.results.length,1);const summary=result.results[0];
  if(nativeObservationFault&&summary.attempted!==500)console.log('SEPAY890_DIAGNOSTIC',JSON.stringify({tick,summary,nativeErrors:errors.split(/\r?\n/).filter(x=>x.startsWith('ERROR:')),observations:nativeObservationErrors}));
  assert.equal(summary.attempted,500);assert.equal(summary.failed,500);assert.equal(summary.succeeded,0);assert.equal(summary.settled,0);assert.equal(summary.status,'partial');assert.equal(summary.pull_status,'ok');
  assert.equal(summary.observation_status,observationLoss?'error':'ok');assert.equal(observations.length,tick);
  assert.equal(observations.at(-1).last_pull_status,'error');assert.equal(observations.at(-1).last_pull_error,'settlement_failed:500');
  console.log('SEPAY871_CURRENT_HANDLER_TICK',JSON.stringify({tick,attempted:500,failed:500,pull:'ok',processing:'partial',observation:summary.observation_status,healthy:false}));
 }
 if(nativeObservationFault){assert.equal(nativeObservationErrors.length,3);writeFileSync('D:/Quy trình/output/reports/sepay890-native-observation-fault-local-20261026.json',JSON.stringify({scope:'actual handler/native selector/native observation UPDATE exception; settlement/provider modeled',nativeObservationErrors,observations,processedAttempts:processed.length,ticks:3},null,2)+'\n');}
 assert.equal(batches.length,3);assert.equal(processed.length,1500);
 const first=new Set(batches[0]),tail=[row(501),row(502)];assert.ok(tail.every(id=>!first.has(id)&&batches[1].includes(id)));
 assert.equal(new Set(batches.slice(0,2).flat()).size,502);
 const counts=new Map();for(const id of processed)counts.set(id,(counts.get(id)??0)+1);
 assert.equal(counts.size,502);assert.ok([...counts.values()].every(n=>n>=1&&n<=3));
 const nativeFinal=await native(`RESET ROLE;SELECT jsonb_build_object('stillUnmatched',(SELECT count(*) FROM public.bank_transactions WHERE account_number='${account}' AND id<='${row(502)}' AND status='unmatched'),
 'markers',(SELECT count(*) FROM private.sepay_settlement_attempts a JOIN public.bank_transactions b ON b.id=a.bank_transaction_id WHERE b.account_number='${account}'),
 'excludedMarked',(SELECT count(*) FROM private.sepay_settlement_attempts WHERE bank_transaction_id IN('${row(601)}','${row(602)}','${row(603)}','${row(604)}')))`);
 assert.deepEqual(nativeFinal,{stillUnmatched:502,markers:502,excludedMarked:0});
 child.stdin.end('ROLLBACK;\n');assert.equal(await done,0,errors);
 console.log('SEPAY871_NATIVE_502_FAIR_SELECTION_PASS',JSON.stringify({uniqueAfter2Ticks:502,attempts:1500,minAttempts:Math.min(...counts.values()),maxAttempts:Math.max(...counts.values()),excludedMarked:0,allFailuresInjected:true,noPayments:true,outerRollback:true,handlerErrorLogs:logs.length}));
}catch(error){phaseError=error;throw error;}
finally{
 if(!child.stdin.writableEnded)child.stdin.end('ROLLBACK;\n');await done;
 try{assert.equal(proof(clone),beforeClone,'871 clone rollback changed protected data/functions');assert.equal(proof(primary),beforePrimary,'871 primary changed');console.log('SEPAY871_CLONE_PRIMARY_AUTH_AND_SELECTOR_UNCHANGED');if(observationBlocked)writeFileSync('D:/Quy trình/output/reports/sepay890-native-observation-blocked-local-20261026.json',JSON.stringify({status:'BLOCKED',reason:'existing native service role UPDATE affected zero target rows; requested P0001 fault not reached',securityWorkExcluded:true,primaryUnchanged:true,cloneUnchanged:true,expectedNativeFaults:3,actualNativeFaults:nativeObservationErrors.length},null,2)+'\n');}
 catch(error){if(!phaseError)throw error;console.error('SEPAY871_POSTCHECK_UNAVAILABLE',error.message);}
}
