import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';

// Real webhook handler + role-scoped SQL, modeled Supabase transport only.
// Caller owns the already-guarded native PG lifecycle and synthetic account.
export function createSePayWebhookNative(service,{account,providerIds}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.match(account,/^TEST-/);
 const literal=value=>`'${String(value).replaceAll("'","''")}'`;
 const json=value=>literal(JSON.stringify(value))+'::jsonb';
 const bankColumns=['provider','provider_txn_id','account_number','sub_account','club_id','gateway','amount','transfer_type','content','txn_ref','occurred_at','status','raw_payload','raw_body'];
 const auditColumns=['provider','verified','http_status','outcome','bank_transaction_id','remote_ip','raw_body'];
 let handler;
 const admin={from:table=>{
  let row=null;const filters={};
  const builder={upsert:(value,options)=>{
   assert.equal(table,'bank_transactions');assert.deepEqual(JSON.parse(JSON.stringify(options)),{onConflict:'provider,account_number,provider_txn_id',ignoreDuplicates:true});
   assert.equal(value.account_number,account);assert.ok(providerIds.has(value.provider_txn_id));
   assert.deepEqual(Object.keys(value).sort(),[...bankColumns].sort());row=value;return builder;
  },insert:async value=>{
   assert.equal(table,'bank_webhook_audit');assert.equal(value.provider,'sepay');
   await service(`WITH saved AS (INSERT INTO public.bank_webhook_audit(${auditColumns.join(',')})
    SELECT ${auditColumns.map(c=>'r.'+c).join(',')} FROM jsonb_populate_record(NULL::public.bank_webhook_audit,${json(value)})r RETURNING id)
    SELECT jsonb_build_object('saved',count(*)) FROM saved;`);
   return {error:null};
  },select:columns=>{
   assert.equal(columns,'id');
   if(!row)return builder;
   return Promise.resolve(service(`WITH saved AS (INSERT INTO public.bank_transactions(${bankColumns.join(',')})
    SELECT ${bankColumns.map(c=>'r.'+c).join(',')} FROM jsonb_populate_record(NULL::public.bank_transactions,${json(row)})r
    ON CONFLICT(provider,account_number,provider_txn_id) DO NOTHING RETURNING id)
    SELECT coalesce(jsonb_agg(saved),'[]'::jsonb) FROM saved;`)).then(data=>({data,error:null}));
  },eq:(key,value)=>{filters[key]=value;return builder;},maybeSingle:async()=>{
   assert.equal(table,'bank_transactions');assert.equal(filters.provider,'sepay');assert.equal(filters.account_number,account);
   assert.ok(providerIds.has(filters.provider_txn_id));
   return {data:await service(`SELECT to_jsonb(t) FROM(SELECT id FROM public.bank_transactions WHERE provider='sepay'
    AND account_number=${literal(account)} AND provider_txn_id=${literal(filters.provider_txn_id)})t;`),error:null};
  }};return builder;
 }};
 const source=readFileSync('supabase/functions/sepay-webhook/index.ts','utf8').replace(/import \{ createClient \} from "https:[^\n]+\n/,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  createClient:()=>admin,Deno:{serve:fn=>{handler=fn;},env:{get:key=>({SUPABASE_URL:'http://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'LOCAL_TEST',SEPAY_WEBHOOK_SECRET:'LOCAL_TEST_WEBHOOK'})[key]}},
  Request,Response,URL,TextEncoder,crypto:webcrypto,Uint8Array,Date,console:{error:()=>{}},
 });
 return handler;
}

export async function ingestSePayWebhookNative(sql,service,{fixture,account,bankRows,reference,failed}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');assert.equal(bankRows.length,3);
 const literal=value=>`'${String(value).replaceAll("'","''")}'`;
 const handler=createSePayWebhookNative(service,{account,providerIds:new Set(bankRows.map(([id])=>'local-'+id))});
 const money=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb)::text) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}';`);
 const before=money(),date=new Date(Date.now()+7*3600000).toISOString().slice(0,19).replace('T',' ');
 const apiRows=[];
 for(const [id,amount]of bankRows){
  const content=id===failed?'UNMATCHED_TEST':reference;
  const body={id:'local-'+id,accountNumber:account,transferAmount:amount,transferType:'in',transactionDate:date,content};
  const invoke=(authorized,payload=body)=>handler(new Request('http://local.invalid/functions/v1/sepay-webhook/LOCAL_TEST_ROUTE',{method:'POST',
   headers:{'Content-Type':'application/json',Authorization:authorized?'Apikey LOCAL_TEST_WEBHOOK':'Apikey WRONG_LOCAL_TEST'},body:JSON.stringify(payload)}));
  assert.equal((await invoke(false)).status,401);
  for(let n=0;n<2;n++){const response=await invoke(true,n?{...body,transferAmount:amount+123,content:'TAMPERED_DUPLICATE_TEST'}:body);assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true});}
  apiRows.push({id:body.id,account_number:account,amount_in:amount,transfer_type:'in',transaction_date:date,transaction_content:content});
 }
 assert.equal(money(),before,'webhook must be inert until independent API verification');
 const rows=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'provider',provider_txn_id,'verified',api_verified_at,'status',status,'amount',amount,'content',content))
  FROM public.bank_transactions WHERE account_number=${literal(account)};`));
 assert.equal(rows.length,3);assert.ok(rows.every(r=>r.verified===null&&r.status==='unmatched'));
 for(const [id,amount]of bankRows){const row=rows.find(r=>r.provider==='local-'+id);assert.equal(row.amount,amount);assert.equal(row.content,id===failed?'UNMATCHED_TEST':reference);}
 const audit=JSON.parse(sql(`SELECT jsonb_object_agg(outcome,n) FROM(SELECT a.outcome,count(*)n FROM public.bank_webhook_audit a
  JOIN public.bank_transactions b ON b.id=a.bank_transaction_id WHERE b.account_number=${literal(account)} GROUP BY a.outcome)t;`));
 assert.deepEqual(audit,{inserted:3,duplicate:3});
 console.log('SEPAY_ACTUAL_WEBHOOK_AUTH_DEDUPE_INERT_REAL_BANK_AUDIT_PASS');
 return {apiRows,ids:new Map(rows.map(row=>[row.provider,row.id]))};
}
