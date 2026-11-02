import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_FNB719_LOCAL,'1');
const source='vinpoker_ops_cash115_qualified_c',clone='vinpoker_fnb719_gate_local';
const stamp='VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
const mode=process.argv[2];assert.ok(['--create','--baseline','--candidate','--writers-first'].includes(mode));
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,q)=>execFileSync('wsl',args(db),{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql('postgres',"SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const originalProof=()=>sql(source,`BEGIN READ ONLY; SELECT md5(jsonb_build_array(
 ${['fnb_orders','fnb_order_items','fnb_order_events','fnb_ingredients','fnb_menu_items','fnb_recipe_items','fnb_stock_movements'].map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${table} x)`).join(',')},
 (SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proowner,proacl,proconfig) ORDER BY oid)
 FROM pg_proc WHERE oid IN('public.fnb_mark_paid(uuid,text)'::regprocedure,'public.fnb_cancel_order(uuid,text)'::regprocedure,'public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure)),
 to_regprocedure('floor_private.fnb_cash_gate718(uuid)')::text)::text);ROLLBACK;`);
const original=originalProof();
const until=async check=>{const end=Date.now()+12000;while(!check()){assert.ok(Date.now()<end,'owned native barrier timeout');await new Promise(resolve=>setTimeout(resolve,20));}};
function session(name){
 const child=spawn('wsl',args(clone),{stdio:['pipe','pipe','pipe'],timeout:20000});
 let output='',errors='',terminal=false;
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;code===0?resolve(output):reject(Error(errors||`session exit${code}`));});});
 void closed.catch(()=>{});
 return {child,closed,output:()=>output,terminal:()=>terminal,name};
}
const club='349ecf35-50ba-4c71-a581-15dc45f1cd01',actor='a364de8e-06b1-4428-a20d-ac614ec406e5';
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
try{
 if(mode==='--create'){
  assert.equal(sql('postgres',`SELECT count(*) FROM pg_database WHERE datname='${clone}';`),'0','owned clone constructor already consumed; do not replace');
  assert.ok(Number(sql('postgres',`SELECT pg_database_size('${source}');`))<=300*1024*1024,'copy exceeds local resource budget');
  assert.equal(sql('postgres',`SELECT count(*) FROM pg_stat_activity WHERE datname='${source}';`),'0','do not disconnect other sessions to copy');
  sql('postgres',`CREATE DATABASE ${clone} TEMPLATE ${source};COMMENT ON DATABASE ${clone} IS ${quote(stamp)};`);
  console.log('FNB719_ISOLATED_CLONE_CREATED',JSON.stringify({clone,source,bytes:Number(sql('postgres',`SELECT pg_database_size('${clone}');`)),stamp}));
 }else{
  assert.equal(sql(clone,`SELECT current_database()||'|'||(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database());`),`${clone}|${stamp}`);
  assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
  assert.equal(sql(clone,"SELECT md5(pg_get_functiondef('net.http_post(text,jsonb,jsonb,jsonb,integer)'::regprocedure));"),'527bf53146f37a72fc9ba50c1a83f1f3');
  if(mode==='--candidate'){
   const candidate=readFileSync('tests/cashier/fnb718.cash-gate.candidate.sql','utf8');
   sql(clone,`BEGIN;SET LOCAL test.fnb719_clone='on';SET LOCAL lock_timeout='2s';${candidate}COMMIT;`);
  }else if(mode==='--baseline')assert.equal(sql(clone,"SELECT to_regprocedure('floor_private.fnb_cash_gate718(uuid)') IS NULL;"),'t');
  else assert.equal(sql(clone,`SELECT md5(pg_get_functiondef('public.fnb_mark_paid(uuid,text)'::regprocedure))||'|'||
   md5(pg_get_functiondef('public.fnb_cancel_order(uuid,text)'::regprocedure))||'|'||md5(pg_get_functiondef('public.fnb_settle_bank_paid(uuid,uuid)'::regprocedure));`),
   '80d5b43e8d3c230899d99c55bc5d6faf|de2d236f942f959948aa16d7e28ab782|458176bb3c8b293d0c44056b15309670');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_menu_items WHERE name=${quote(`LOCAL719 ${mode} item`)};`),'0','phase fixture already consumed; do not regenerate');
  const menu=randomUUID(),ingredient=randomUUID(),key=randomUUID();
  const order=JSON.parse(sql(clone,`BEGIN;INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost)
   VALUES('${ingredient}','${club}','LOCAL719 ${mode} ingredient','unit',10,1000);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,tracks_inventory) VALUES('${menu}','${club}','LOCAL719 ${mode} item',5000,true);
   INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
   ${auth}SELECT public.fnb_create_order('${club}','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'${key}');COMMIT;`)
   .split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(order.status,'ok');const orderId=order.order_id;
  async function heldGate(label,rpc){
   const tag=randomUUID().slice(0,8),a=session(`fnb719_${tag}_a`),b=session(`fnb719_${tag}_b`);
   let observed=false,result,release;
   try{
    a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='15s';SELECT pg_advisory_xact_lock(hashtextextended('fnb-cash-shift:${club}',718));SELECT 'FNB719_GATE_READY';\n`);
    await until(()=>a.output().includes('FNB719_GATE_READY'));
    b.child.stdin.end(`SET application_name='${b.name}';BEGIN;SET LOCAL statement_timeout='15s';${auth}SELECT ${rpc};COMMIT;\n`);
    await until(()=>{
     observed=sql(clone,`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${a.name}'
      WHERE b.application_name='${b.name}' AND b.wait_event_type='Lock' AND b.wait_event='advisory' AND a.pid=ANY(pg_blocking_pids(b.pid)));`)==='t';
     return observed||b.terminal();
    });
    release=sql(clone,'SELECT clock_timestamp();');a.child.stdin.end('COMMIT;\n');
    const [,reply]=await Promise.all([a.closed,b.closed]);
    result=JSON.parse(reply.split(/\r?\n/).find(line=>line.startsWith('{')));assert.equal(result.status,'ok');
    assert.equal(observed,mode==='--candidate',`${label} must wait on actual advisory gate only in candidate, not DDL/order lock`);
    if(mode==='--candidate')assert.equal(sql(clone,`SELECT ${label==='pay'?'paid_at':'cancelled_at'}>=${quote(release)}::timestamptz FROM public.fnb_orders WHERE id='${orderId}';`),'t','stamp must follow blocked transaction release');
    console.log('FNB719_NATIVE_GATE_OBSERVATION',JSON.stringify({mode,label,observed,release,order:orderId,result}));
   }finally{
    if(!a.child.stdin.destroyed&&!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
    if(!b.child.stdin.destroyed&&!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([a.closed,b.closed]);
   }
  }
  async function heldWriter(label,rpc){
   const tag=randomUUID().slice(0,8),a=session(`fnb719_${tag}_writer`),b=session(`fnb719_${tag}_cutover`);
   try{
    a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='15s';${auth}SELECT ${rpc};SELECT 'FNB719_WRITER_READY';\n`);
    await until(()=>a.output().includes('FNB719_WRITER_READY'));
    b.child.stdin.end(`SET application_name='${b.name}';BEGIN;SET LOCAL statement_timeout='15s';
     SELECT pg_advisory_xact_lock(hashtextextended('fnb-cash-shift:${club}',718));
     SELECT jsonb_build_object('observed_status',status,'stamp_before_cutover',${label==='pay'?'paid_at':'cancelled_at'}<=clock_timestamp()) FROM public.fnb_orders WHERE id='${orderId}';COMMIT;\n`);
    await until(()=>sql(clone,`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${a.name}'
     WHERE b.application_name='${b.name}' AND b.wait_event_type='Lock' AND b.wait_event='advisory' AND a.pid=ANY(pg_blocking_pids(b.pid)));`)==='t');
    a.child.stdin.end('COMMIT;\n');const [reply,cutoverReply]=await Promise.all([a.closed,b.closed]);
    const result=JSON.parse(reply.split(/\r?\n/).find(line=>line.startsWith('{')));
    const cutover=JSON.parse(cutoverReply.split(/\r?\n/).find(line=>line.startsWith('{')));
    assert.equal(result.status,'ok');assert.equal(cutover.observed_status,label==='pay'?'paid':'cancelled');assert.equal(cutover.stamp_before_cutover,true);
    console.log('FNB719_WRITER_FIRST_GATE_OBSERVATION',JSON.stringify({label,order:orderId,result,cutover}));
   }finally{
    if(!a.child.stdin.destroyed&&!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
    if(!b.child.stdin.destroyed&&!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([a.closed,b.closed]);
   }
  }
  const overlap=mode==='--writers-first'?heldWriter:heldGate;
  await overlap('pay',`public.fnb_mark_paid('${orderId}','${randomUUID()}')`);
  assert.equal(sql(clone,`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'8');
  await overlap('refund',`public.fnb_cancel_order('${orderId}','LOCAL719 compensating refund')`);
  assert.equal(sql(clone,`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'10');
  assert.equal(sql(clone,`SELECT count(*)||'|'||sum(delta) FROM public.fnb_stock_movements WHERE ref_id='${orderId}';`),'2|0');
  console.log('FNB719_CLONE_TWO_SESSION_PHASE_COMPLETE_NOT_FULL_SHIFT',JSON.stringify({clone,mode,menu,ingredient,order:orderId,stock:10}));
 }
}finally{assert.equal(originalProof(),original,'original database F&B facts/functions/ACL must not change');console.log('FNB719_ORIGINAL_DATABASE_UNCHANGED');}
