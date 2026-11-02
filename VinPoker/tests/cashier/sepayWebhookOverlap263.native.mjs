import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSePayWebhookNative} from './sepayWebhook.native.mjs';

export async function runSePayWebhookOverlap263(sql,{session,until}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql('SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
 assert.equal(sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();'),'0');
 const account='TEST-webhook263-'+randomUUID();
 const q=v=>`'${String(v).replaceAll("'","''")}'`;
 const facts=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_transactions x WHERE account_number<>${q(account)}),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_webhook_audit x WHERE bank_transaction_id IS NULL OR bank_transaction_id NOT IN(SELECT id FROM public.bank_transactions WHERE account_number=${q(account)})),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const before=facts();
 // Same explicit managed-service RLS model as sepayReconcile.native.mjs.
 // Never alter service_role itself or any policy; the NOLOGIN fixture is removed.
 const role='sepay263_'+randomUUID().replaceAll('-','');
 sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${role};`);
 const claims=`SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE ${role};`;
 const service=statement=>JSON.parse(sql(`BEGIN;${claims}${statement}COMMIT;`));
 try{
 for(const order of ['original-first','changed-first']){
  const provider='local-'+randomUUID(),suffix=randomUUID().slice(0,8),a=session('webhook263_a_'+suffix),b=session('webhook263_b_'+suffix);
  let release;const gate=new Promise(resolve=>{release=resolve;});let held=false,waited=false;
  const scopedService=(handle,hold)=>async statement=>{
   if(!statement.includes('INSERT INTO public.bank_transactions('))return service(statement);
   handle.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';${claims}${statement}SELECT 'WEBHOOK263_RESULT';\n`);
   await until(()=>handle.output().includes('WEBHOOK263_RESULT'));
   const data=JSON.parse(handle.output().split('\n').find(line=>line.startsWith('[')));
   if(hold){held=true;await gate;}else waited=true;
   handle.child.stdin.end('COMMIT;\n');await handle.closed;return data;
  };
  const h1=createSePayWebhookNative(scopedService(a,true),{account,providerIds:new Set([provider])});
  const h2=createSePayWebhookNative(scopedService(b,false),{account,providerIds:new Set([provider])});
  const date=new Date(Date.now()+7*3600000).toISOString().slice(0,19).replace('T',' ');
  const body={id:provider,accountNumber:account,transferAmount:order==='original-first'?100000:123456,transferType:'in',transactionDate:date,content:'UNMATCHED_263_TEST'};
  const request=value=>new Request('http://local.invalid/functions/v1/sepay-webhook/LOCAL_TEST_ROUTE',{method:'POST',headers:{Authorization:'Apikey LOCAL_TEST_WEBHOOK','Content-Type':'application/json'},body:JSON.stringify(value)});
  let first,second;
  try{
   first=h1(request(body));void first.catch(()=>{});
   await Promise.race([until(()=>held),first.then(response=>{throw Error('first handler ended before held barrier: '+response.status);}),a.closed.then(()=>{throw Error('first SQL session ended before held barrier');})]);
   second=h2(request({...body,transferAmount:body.transferAmount+777,content:'CHANGED_DUPLICATE_263_TEST'}));void second.catch(()=>{});
   await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='webhook263_b_${suffix}' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
   assert.equal(waited,false,'second actual PostgreSQL INSERT is blocked, not merely Promise.all');
   release();const responses=await Promise.all([first,second]);
   for(const response of responses){assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true});}
   const rows=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT id,amount,content,status,api_verified_at FROM public.bank_transactions WHERE account_number=${q(account)} AND provider_txn_id=${q(provider)})x;`));
   assert.equal(rows.length,1);assert.equal(rows[0].amount,body.transferAmount);assert.equal(rows[0].content,body.content);
   assert.equal(rows[0].status,'unmatched');assert.equal(rows[0].api_verified_at,null);
   const replay=createSePayWebhookNative(service,{account,providerIds:new Set([provider])});
   assert.equal((await replay(request({...body,transferAmount:1}))).status,200);
   const audit=JSON.parse(sql(`SELECT jsonb_object_agg(outcome,n) FROM(SELECT outcome,count(*)n FROM public.bank_webhook_audit WHERE bank_transaction_id='${rows[0].id}' GROUP BY outcome)x;`));
   assert.deepEqual(audit,{inserted:1,duplicate:2});
   console.log('SEPAY263_ACTUAL_HANDLER_TWO_PG_SESSIONS_LOCKED_DEDUPE_INERT_PASS',JSON.stringify({order,bankId:rows[0].id,audit}));
  }finally{
   release();for(const handle of[a,b])if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
   await Promise.allSettled([first,second,a.closed,b.closed].filter(Boolean));
  }
 }
 assert.equal(facts(),before,'all prior bank/audit and business facts unchanged');
 // Retained own synthetic events intentionally stay inert/audited, never delete ledger/audit.
 console.log('SEPAY263_PRIOR_BANK_AUDIT_MONEY_ENTRY_NOTIFICATION_UNCHANGED_PASS');
 }finally{sql(`DROP ROLE ${role};`);}
 assert.equal(sql(`SELECT count(*) FROM pg_roles WHERE rolname=${q(role)};`),'0');
 console.log('SEPAY263_NOLOGIN_ROLE_REMOVED_BASE_ROLE_RLS_UNCHANGED_PASS');
}
