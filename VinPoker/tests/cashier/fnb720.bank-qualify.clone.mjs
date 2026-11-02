import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_FNB720_LOCAL,'1');
const clone='vinpoker_fnb719_gate_local',source='vinpoker_ops_cash115_qualified_c';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,q)=>execFileSync('wsl',args(db),{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const proof=()=>sql(source,`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${['fnb_orders','fnb_order_items','fnb_stock_movements','fnb_ingredients','fnb_settings','platform_bank_accounts','bank_transactions','payment_settlements'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')},
 pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure))::text);ROLLBACK;`);
const before=proof(),f=JSON.parse(sql(clone,'SELECT fixture FROM floor_private.fnb720_fixture;'));
for(const key of ['club','actor','order','menu','ingredient','bank','bad_bank'])assert.match(f[key],/^[a-f0-9-]{36}$/);
assert.equal(f.test_only,true);
assert.equal(sql(clone,`SELECT count(*) FROM public.bank_transactions WHERE id IN('${f.bank}','${f.bad_bank}') AND account_number LIKE 'TEST-NON-BANK720-%';`),'2');
const service="SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{\"role\":\"service_role\"}';SET LOCAL ROLE service_role;";
const parse=output=>JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{')));
const settle=bank=>parse(sql(clone,`BEGIN;${service}SELECT public.settle_bank_transaction('${bank}',true);COMMIT;`));
function session(name){
 const child=spawn('wsl',args(clone),{stdio:['pipe','pipe','pipe'],timeout:20000});let out='',err='';
 child.stdout.on('data',x=>{out+=x;});child.stderr.on('data',x=>{err+=x;});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(err||`exit${code}`)));});void closed.catch(()=>{});
 return {child,closed,out:()=>out,name};
}
const until=async test=>{const end=Date.now()+12000;while(!test()){assert.ok(Date.now()<end,'bank gate barrier timeout');await new Promise(resolve=>setTimeout(resolve,20));}};
try{
 assert.equal(sql(clone,`SELECT count(*) FROM public.payment_settlements WHERE bank_transaction_id IN('${f.bank}','${f.bad_bank}');`),'0','qualification stage already consumed');
 assert.equal(sql(clone,"SELECT has_function_privilege('authenticated','public.settle_bank_transaction(uuid,boolean)','EXECUTE') OR has_function_privilege('anon','public.fnb_settle_bank_paid(uuid,uuid)','EXECUTE');"),'f');
 const unverified=settle(f.bank);assert.equal(unverified.skipped,'not_api_verified');
 sql(clone,`UPDATE public.bank_transactions SET api_verified_at=clock_timestamp() WHERE id='${f.bank}' AND account_number LIKE 'TEST-NON-BANK720-%';`);
 const off=settle(f.bank);assert.equal(off.reason,'fnb_auto_disabled');assert.equal(off.auto_confirm,false);
 assert.equal(sql(clone,`SELECT status||'|'||(SELECT on_hand FROM public.fnb_ingredients WHERE id='${f.ingredient}') FROM public.fnb_orders WHERE id='${f.order}';`),'pending|10');
 sql(clone,`UPDATE public.fnb_settings SET guest_bank_auto_confirm=true WHERE club_id='${f.club}';`);
 const bad=settle(f.bad_bank);assert.equal(bad.outcome,'flagged_amount_mismatch');
 const deny=parse(sql(clone,`BEGIN;SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
  SELECT public.fnb_mark_paid('${f.order}');COMMIT;`));assert.equal(deny.error,'Forbidden');
 const a=session('fnb720_gate_owner'),b=session('fnb720_bank_worker');let result,release;
 try{
  a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='15s';SELECT pg_advisory_xact_lock(hashtextextended('fnb-cash-shift:${f.club}',718));SELECT 'FNB720_GATE_READY';\n`);
  await until(()=>a.out().includes('FNB720_GATE_READY'));
  b.child.stdin.end(`SET application_name='${b.name}';BEGIN;SET LOCAL statement_timeout='15s';${service}SELECT public.settle_bank_transaction('${f.bank}',true);COMMIT;\n`);
  await until(()=>sql(clone,`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${a.name}' WHERE b.application_name='${b.name}' AND b.wait_event='advisory' AND a.pid=ANY(pg_blocking_pids(b.pid)));`)==='t');
  release=sql(clone,'SELECT clock_timestamp();');a.child.stdin.end('COMMIT;\n');
  const [,reply]=await Promise.all([a.closed,b.closed]);result=parse(reply);assert.equal(result.outcome,'auto_confirmed');
 }finally{
  if(!a.child.stdin.destroyed&&!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
  if(!b.child.stdin.destroyed&&!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
 }
 const replay=settle(f.bank);assert.equal(replay.already_settled,true);assert.equal(replay.outcome,'auto_confirmed');
 const facts=JSON.parse(sql(clone,`SELECT jsonb_build_object('status',o.status,'method',o.payment_method,'price',o.subtotal_vnd,'cogs',o.cogs_vnd,'after_gate',o.paid_at>='${release}'::timestamptz,
  'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='${f.ingredient}'),
  'sale_movements',(SELECT count(*) FROM public.fnb_stock_movements WHERE ref_id=o.id AND reason='sale'),
  'settlements',(SELECT count(*) FROM public.payment_settlements WHERE bank_transaction_id='${f.bank}')) FROM public.fnb_orders o WHERE id='${f.order}';`));
 assert.deepEqual(facts,{status:'paid',method:'bank_transfer',price:5000,cogs:2000,after_gate:true,stock:8,sale_movements:1,settlements:1});
 console.log('FNB720_CLONE_REAL_BANK_SETTLEMENT_GATE_FROZEN_PRICE_REPLAY_NEGATIVES',JSON.stringify({fixture:f,result,replay,facts,unverified,off,bad,deny}));
}finally{assert.equal(proof(),before,'original source bank/FNB facts must remain unchanged');console.log('FNB720_ORIGINAL_DATABASE_UNCHANGED');}
