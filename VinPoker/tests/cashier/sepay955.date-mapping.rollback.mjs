// Actual reconcile mapping → native ingest/readback, provider/other RPCs modeled. Every SQL write rolls back.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

assert.equal(process.env.VINPOKER_SEPAY955_LOCAL,'1');
const amount1225=process.env.VINPOKER_SEPAY1225_LOCAL==='1';
const phase=process.env.VINPOKER_SEPAY955_PHASE;assert.ok((amount1225?['before','after','after-settle','after-settle-qualified']:['before','after']).includes(phase));
const settle1225=amount1225&&phase.startsWith('after-settle');
const db='vinpoker_ranking860_local',club='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
const account='TEST955_'+randomUUID(),bankAccount='fa955000-0000-4000-8000-000000000001';
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=statement=>execFileSync('wsl',args,{input:statement,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${db}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql('SELECT package_hash FROM floor_private.ranking860_install_backup;'),'d786e04b14c42eaeb0832b97ea47f992eacd755ad1e94d9022f6a28920c778bd');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const tables=['public.bank_transactions','public.bank_webhook_audit','public.cashier_buyin_movements','public.tournament_entries','public.tournament_seats','public.tournament_prize_payments','public.notifications','public.payment_settlements','public.club_payment_config'];
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(table=>`(SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM ${table} r)`).join(',')},md5(pg_get_functiondef('auth.uid()'::regprocedure)))::text);ROLLBACK;`);
const before=proof();
const cases=amount1225?[['0x10',null],['0XFF',null],['0b10',null],['0o10',null],['1000.6',1001],['1e3',1000],[1000,1000]]:[
 ['2026-02-30 10:00:00',null],['2025-02-29 10:00:00',null],['2026-04-31 10:00:00',null],
 ['2026-10-19 24:00:00',null],['2026-10-19 10:60:00',null],
 ['2024-02-29 00:00:00','2024-02-28T17:00:00.000Z'],
 ['2026-01-01 00:00:00','2025-12-31T17:00:00.000Z'],
 ['2026-10-19T23:59:59','2026-10-19T16:59:59.000Z'],
];
const providerRows=cases.map(([date])=>({id:randomUUID(),account_number:account,bank_account_id:bankAccount,transfer_type:'in',amount_in:amount1225?date:1000,transaction_date:amount1225?'2026-10-19 10:00:00':date,transaction_content:'UNMATCHED_LOCAL955_TEST'}));
const content=readFileSync('supabase/functions/sepay-reconcile/index.ts','utf8');
const state={phase,scope:'actual reconcile handler mapping/native service-role ingest; provider/config/lease/worklist modeled; all SQL writes rollback',sourceSha256:createHash('sha256').update(content).digest('hex'),mapped:[],nativeRows:[],ingestCalls:0,settlementCalls:0,protectedUnchanged:false};
const output=amount1225?`D:/Quy trình/output/reports/sepay1225-amount-${phase}-local-20261028.json`:`D:/Quy trình/output/reports/sepay955-date-${phase}-local-20261027.json`;
if(amount1225)assert.equal(existsSync(output),false);
let handler;
const rpc=async(name,params)=>{
 if(name==='sepay_get_active_payment_clubs')return {data:[{club_id:club,master_account_number:account}],error:null};
 if(name==='sepay_get_club_api_token')return {data:'LOCAL955_PROVIDER_MODEL',error:null};
 if(name==='sepay_claim_pull_v2')return {data:{status:'claimed',lease_token:'fa955000-0000-4000-8000-000000000002',window_from:'2026-10-19T00:00:00Z',window_to:'2026-10-20T00:00:00Z',next_page:1},error:null};
 if(name==='sepay_ingest_verified_transactions'){
  state.ingestCalls++;state.mapped=params.p_txns.map(row=>({provider_txn_id:row.provider_txn_id,occurred_at:row.occurred_at,amount:row.amount,rawDate:row.raw_payload.transaction_date}));
  const payload=quote(JSON.stringify(params.p_txns))+'::jsonb';
  const result=sql(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;
   SELECT public.sepay_ingest_verified_transactions(${payload});RESET ROLE;
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('provider_txn_id',provider_txn_id,'occurred_at',occurred_at,'amount',amount,'rawDate',raw_payload->>'transaction_date','status',status,'api_verified',api_verified_at IS NOT NULL) ORDER BY provider_txn_id) FROM public.bank_transactions WHERE account_number=${quote(account)}),'[]'::jsonb));${settle1225?`DO $$ DECLARE ids uuid[]; bank_id uuid; reply jsonb; BEGIN SELECT array_agg(id) INTO ids FROM public.bank_transactions WHERE account_number=${quote(account)} AND amount IS NULL; ASSERT cardinality(ids)=4; PERFORM set_config('role','service_role',true); FOREACH bank_id IN ARRAY ids LOOP reply:=public.settle_bank_transaction(bank_id,true); ASSERT reply->>'skipped'='not_settleable_shape',reply::text; END LOOP; PERFORM set_config('role','none',true); END $$; SELECT jsonb_build_object('settlements',4);`:''}ROLLBACK;`);
  state.nativeRows=JSON.parse(result.split(/\r?\n/).find(line=>line.startsWith('{'))).rows;
  if(settle1225){state.nativeSettlementGuards=JSON.parse(result.split(/\r?\n/).find(line=>line.includes('\"settlements\"'))).settlements;assert.equal(state.nativeSettlementGuards,4);}
  return {data:state.nativeRows.length,error:null};
 }
 if(name==='sepay_checkpoint_pull_v2')return {data:{ok:true,next_page:params.p_next_page,complete:params.p_complete},error:null};
 if(name==='sepay_take_settlement_batch_v1')return {data:[],error:null};
 if(name==='cashier_retry_paid_seating_v1')return {data:{ok:true,attempted:0,seated:0,needs_review:0},error:null};
 state.settlementCalls++;throw Error('unexpected RPC '+name);
};
const admin={rpc,from:()=>{const query={select:()=>query,eq:()=>query,update:()=>query,maybeSingle:async()=>({data:{enabled:true},error:null}),then:(resolve,reject)=>Promise.resolve({data:null,error:null}).then(resolve,reject)};return query;}};
try{
 const source=content.replace(/import \{ createClient \} from "https:[^\n]+\n/,'').replace(/import \{ retryFetch \} from "[^\n]+\n/,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>admin,retryFetch:async url=>new Response(JSON.stringify(new URL(url).pathname==='/v2/bank-accounts'?{data:[{id:bankAccount,account_number:account,active:true}],meta:{pagination:{has_more:false}}}:{data:providerRows,meta:{pagination:{total:providerRows.length,has_more:false}}}),{status:200}),
  Deno:{env:{get:key=>({SUPABASE_URL:'http://local955.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL955_SERVICE_MODEL',SEPAY_RECONCILE_SECRET:'LOCAL955_SECRET_MODEL',SEPAY_AUTO_CONFIRM:'true'}[key])},serve:fn=>{handler=fn;}},
  Request,Response,TextEncoder,crypto:webcrypto,Date,Uint8Array,console:{error:()=>{}},
 });
 const response=await handler(new Request('http://local955.invalid/reconcile',{method:'POST',headers:{'X-Reconcile-Secret':'LOCAL955_SECRET_MODEL'}}));
 state.response={status:response.status,body:await response.json()};assert.equal(state.response.status,200);assert.equal(state.response.body.ok,true);
 assert.equal(state.ingestCalls,1);assert.equal(state.settlementCalls,0);assert.equal(state.nativeRows.length,cases.length);
 for(let index=0;index<cases.length;index++){
  const actual=state.nativeRows.find(row=>row.provider_txn_id===providerRows[index].id),expected=cases[index][1];
  if(amount1225){assert.equal(actual.amount,expected,'native amount for '+cases[index][0]);continue;}
  assert.equal(actual.rawDate,cases[index][0]);assert.equal(actual.amount,1000);assert.equal(actual.api_verified,true);
  assert.equal(actual.occurred_at===null?null:new Date(actual.occurred_at).toISOString(),expected,'native occurred_at for '+cases[index][0]);
 }
 console.log(amount1225?'SEPAY1225_NATIVE_AMOUNT_MAPPING_PASS':'SEPAY955_NATIVE_DATE_MAPPING_PASS',JSON.stringify({rows:state.nativeRows.length,ingestCalls:1,settlementCalls:0}));
}catch(error){state.failure=String(error);throw error;}
finally{state.protectedUnchanged=proof()===before;writeFileSync(output,JSON.stringify(state,null,2)+'\n');assert.equal(state.protectedUnchanged,true);console.log('SEPAY955_PROTECTED_ROLLBACK_UNCHANGED');}
