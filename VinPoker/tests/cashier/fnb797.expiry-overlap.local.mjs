import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.VINPOKER_FNB797_READONLY_ROLLBACK,'1');
const paymentRace=process.env.VINPOKER_FNB798_PAYMENT_RACE==='1';
const base=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',base,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
const tables=['fnb_orders','fnb_order_items','fnb_order_events','fnb_ingredients','fnb_stock_movements','fnb_cashier_shifts','cashier_buyin_movements','tournament_entries','tournament_seats'];
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${table} x)`).join(',')})::text);`);
const before=fingerprint();
const target=JSON.parse(sql(`SELECT jsonb_build_object('id',o.id,'actor',(SELECT owner_id FROM public.clubs WHERE id=o.club_id),'events',(SELECT count(*) FROM public.fnb_order_events e WHERE e.order_id=o.id AND e.action='expired'))
 FROM public.fnb_orders o WHERE o.status='pending' AND o.created_at<now()-(CASE WHEN o.payment_method='bank_transfer'
 THEN coalesce((SELECT guest_bank_ttl_secs FROM public.fnb_settings WHERE club_id=o.club_id),1800)
 ELSE coalesce((SELECT pending_ttl_secs FROM public.fnb_settings WHERE club_id=o.club_id),900) END*interval '1 second') ORDER BY o.created_at,o.id LIMIT 1;`));
assert.match(target.id,/^[a-f0-9-]{36}$/i);
const suffix=randomUUID();
function session(label){
 const name=`fnb797-${label}-${suffix}`;
 const child=spawn('wsl',base,{stdio:['pipe','pipe','pipe']});let output='',errors='';
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{errors+=value;});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(errors)));});
 void closed.catch(()=>{});
 const send=q=>child.stdin.write(q+'\n');
 const until=async marker=>{const end=Date.now()+8000;while(!output.includes(marker)){
  assert.ok(child.exitCode===null,errors);assert.ok(Date.now()<end,`${label} missing ${marker}: ${errors}`);await delay(40);
 }};
 send(`SET application_name='${name}';`);
 return {name,send,until,get output(){return output;},async close(){if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');await closed;}};
}
const service="SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{\"role\":\"service_role\"}';SET LOCAL ROLE service_role;";
const stateSql=`SELECT jsonb_build_object('status',o.status,'events',(SELECT count(*) FROM public.fnb_order_events e WHERE e.order_id=o.id AND e.action='expired')) FROM public.fnb_orders o WHERE o.id='${target.id}';`;
const hold=session('hold'),worker=session('worker');
try{
 assert.match(target.actor,/^[a-f0-9-]{36}$/i);
 const holdAction=paymentRace?`SET LOCAL request.jwt.claim.sub='${target.actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${target.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT 'PAYMENT|'||public.fnb_mark_paid('${target.id}','LOCAL798-${suffix}')::text;RESET ROLE;
 SELECT 'PAY_STATE|'||status::text FROM public.fnb_orders WHERE id='${target.id}';`
 :`SELECT id FROM public.fnb_orders WHERE id='${target.id}' FOR UPDATE;`;
 hold.send(`BEGIN;SET LOCAL statement_timeout='10s';${holdAction}SELECT 'LOCK_HELD';`);
 await hold.until('LOCK_HELD');
 if(paymentRace){
  const payment=JSON.parse(hold.output.split(/\r?\n/).find(line=>line.startsWith('PAYMENT|')).slice('PAYMENT|'.length));
  assert.equal(payment.status,'ok');assert.equal(payment.order_id,target.id);assert.equal(payment.idempotent,false);
  assert.ok(hold.output.includes('PAY_STATE|paid'),'canonical writer did not reach paid inside transaction');
 }
 assert.equal(sql(`SELECT count(*) FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name='${hold.name}' AND a.state='idle in transaction' AND l.relation='public.fnb_orders'::regclass AND l.mode='RowShareLock' AND l.granted;`),'1');
 worker.send(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='500ms';${service}
 SELECT public.fnb_expire_pending_orders();RESET ROLE;${stateSql}SELECT 'WORKER_SKIPPED_HELD';`);
 await worker.until('WORKER_SKIPPED_HELD');
 const state=JSON.parse(worker.output.split(/\r?\n/).find(line=>line.startsWith('{')));
 assert.deepEqual(state,{status:'pending',events:target.events});
 worker.send("ROLLBACK;SELECT 'WORKER_ROLLED_BACK';");await worker.until('WORKER_ROLLED_BACK');
 hold.send("ROLLBACK;SELECT 'HOLDER_RELEASED';");await hold.until('HOLDER_RELEASED');
 // Positive control: same retained row is eligible once unlocked; never commit expiry.
 const positive=sql(`BEGIN;SET LOCAL statement_timeout='5s';${service}SELECT public.fnb_expire_pending_orders();RESET ROLE;${stateSql}ROLLBACK;`);
 const expired=JSON.parse(positive.split(/\r?\n/).find(line=>line.startsWith('{')));
 assert.deepEqual(expired,{status:'expired',events:target.events+1});
 assert.equal(fingerprint(),before,'global retained facts changed');
}finally{
 const cleanup=await Promise.allSettled([hold.close(),worker.close()]);
 assert.ok(cleanup.every(result=>result.status==='fulfilled'),'child-session rollback/close failed');
 assert.equal(fingerprint(),before,'cleanup did not preserve retained facts');
}
console.log(paymentRace?'FNB798_NATIVE_ACTUAL_OWNER_PAYMENT_TRANSACTION_EXPIRY_SKIPS_ABORT_PAYMENT_THEN_EXPIRY_ALL_ROLLBACK_NINE_TABLES_PRESERVED_PASS'
 :'FNB797_NATIVE_TWO_SESSION_ROW_LOCK_SKIP_NO_EVENT_UNLOCK_POSITIVE_ALL_ROLLBACK_NINE_TABLES_PRESERVED_PASS');
