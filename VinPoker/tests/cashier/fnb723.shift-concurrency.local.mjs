import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_FNB723_LOCAL,'1');
const mode=process.argv[2];assert.ok(['--install','--run','--bank724','--intent725-install','--intent726','--comp728-baseline','--comp728-fix','--comp728-fixed','--create734-baseline','--create734-fix','--create734-fixed','--comp737-key-baseline','--cancel737-install','--cancel737-run','--cancel738-rr-baseline','--rr738-fix','--rr738-fixed','--cancel739-final'].includes(mode));
const source='vinpoker_ops_cash115_qualified_c',clone='vinpoker_fnb719_gate_local';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(db,q)=>execFileSync('wsl',args(db),{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const parse=output=>JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{')));
assert.equal(sql(clone,"SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),`${clone}|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data`);
assert.equal(sql(clone,"SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql(clone,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const sourceProof=()=>sql(source,`BEGIN READ ONLY;SELECT md5(jsonb_build_array(
 ${['fnb_orders','fnb_order_items','fnb_order_events','fnb_stock_movements','fnb_ingredients','bank_transactions','payment_settlements'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')},
 (SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) ORDER BY p.oid) FROM pg_proc p
 WHERE proname IN('fnb_mark_paid','fnb_cancel_order','fnb_settle_bank_paid','fnb_create_comp_order','fnb_create_order','fnb_list_link_targets','_fnb_bind_create_intent_v1','fnb_get_create_receipt_v1','fnb_cancel_create_intent_v1')),
 to_regclass('public.fnb_cashier_shifts')::text)::text);ROLLBACK;`);
const failed720Proof=()=>sql(clone,`BEGIN READ ONLY;SELECT md5(jsonb_build_array(
 (SELECT to_jsonb(o) FROM public.fnb_orders o WHERE id=(f.fixture->>'order')::uuid),
 (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.bank_transactions b WHERE id IN((f.fixture->>'bank')::uuid,(f.fixture->>'bad_bank')::uuid)),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.payment_settlements s WHERE bank_transaction_id IN((f.fixture->>'bank')::uuid,(f.fixture->>'bad_bank')::uuid)),
 (SELECT to_jsonb(i) FROM public.fnb_ingredients i WHERE id=(f.fixture->>'ingredient')::uuid),
 (SELECT jsonb_agg(to_jsonb(m)) FROM public.fnb_stock_movements m WHERE ref_id=(f.fixture->>'order')::uuid))::text)
 FROM floor_private.fnb720_fixture f;ROLLBACK;`);
const beforeSource=sourceProof(),before720=failed720Proof();
const auth=actor=>`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
function session(name){
 const child=spawn('wsl',args(clone),{stdio:['pipe','pipe','pipe'],timeout:25000});let output='',errors='',terminal=false;
 child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{errors+=x;});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;code===0?resolve(output):reject(Error(errors||`native exit${code}`));});});void closed.catch(()=>{});
 return {child,closed,name,output:()=>output,terminal:()=>terminal,errors:()=>errors};
}
async function until(test,workers=[]){const end=Date.now()+15000;while(!test()){
 for(const worker of workers)assert.ok(!worker.terminal(),worker.errors()||'native session ended before barrier');
 assert.ok(Date.now()<end,'native barrier observation timeout; no restart');await new Promise(resolve=>setTimeout(resolve,20));
}}
const blocked=(a,b)=>sql(clone,`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='${a.name}'
 WHERE b.application_name='${b.name}' AND b.wait_event_type='Lock' AND b.wait_event='advisory' AND a.pid=ANY(pg_blocking_pids(b.pid)));`)==='t';
async function overlap(label,actor,firstSql,secondSql,secondActor=actor,secondSetup=''){
 const tag=randomUUID().slice(0,8),a=session(`fnb723_${tag}_a`),b=session(`fnb723_${tag}_b`);
 try{
  a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='20s';${auth(actor)}${firstSql}SELECT 'FNB723_FIRST_RPC_HELD';\n`);
  await until(()=>a.output().includes('FNB723_FIRST_RPC_HELD'),[a]);
  b.child.stdin.end(`SET application_name='${b.name}';BEGIN;${secondSetup}SET LOCAL statement_timeout='20s';${auth(secondActor)}${secondSql}COMMIT;\n`);
  await until(()=>blocked(a,b),[a,b]);
  a.child.stdin.end('COMMIT;\n');const [first,second]=await Promise.all([a.closed,b.closed]);
  console.log('FNB723_ACTUAL_RPC_ADVISORY_BLOCKING_OBSERVED',JSON.stringify({label,first:parse(first),second:parse(second)}));
  return {first:parse(first),second:parse(second)};
 }finally{
  for(const worker of [a,b])if(!worker.child.stdin.destroyed&&!worker.child.stdin.writableEnded)worker.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled([a.closed,b.closed]);
 }
}
try{
 if(mode==='--install'){
  assert.equal(sql(clone,"SELECT to_regclass('public.fnb_cashier_shifts') IS NULL AND to_regprocedure('floor_private.fnb_cash_event_gate_v1(uuid)') IS NULL;"),'t','clone installation already consumed');
  const signatures=['public.fnb_mark_paid(uuid,text)','public.fnb_cancel_order(uuid,text)','public.fnb_settle_bank_paid(uuid,uuid)'];
  const sourceHashes=['c8d1b825e471fab2038c0552532dbc15','7a40b0d5f0103b4dbcf7848079aca94b','779c15e9a2763eb2c8b7b0c0aaea7206'];
  const cloneHashes=['80d5b43e8d3c230899d99c55bc5d6faf','de2d236f942f959948aa16d7e28ab782','458176bb3c8b293d0c44056b15309670'];
  const definitions=signatures.map((signature,i)=>{
   assert.equal(sql(source,`SELECT md5(pg_get_functiondef(${quote(signature)}::regprocedure));`),sourceHashes[i]);
   assert.equal(sql(clone,`SELECT md5(pg_get_functiondef(${quote(signature)}::regprocedure));`),cloneHashes[i]);
   return JSON.parse(sql(source,`SELECT to_json(pg_get_functiondef(${quote(signature)}::regprocedure));`));
  });
  let migration=readFileSync('supabase/migrations/20270128000278_fnb_order_event_integrity_v1.sql','utf8');
  assert.equal((migration.match(/^BEGIN;\r?$/gm)||[]).length,1);assert.equal((migration.match(/^COMMIT;\r?$/gm)||[]).length,1);
  migration=migration.replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\r?\n?/m,'');
  // Replace ONLY reviewed719 prototype bodies on the owned clone, atomically upgrading to exact278.
  // This is NOT a data reset or recovery/rematch of failed720 transactions.
  sql(clone,`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';SET LOCAL test.fnb723_clone='on';
   ${definitions.join(';\n')};\n${migration}\n${readFileSync('tests/cashier/fnb722.shift-backend.candidate.sql','utf8')}COMMIT;`);
  console.log('FNB723_EXACT278_AND722_CANDIDATE_INSTALLED_OWNED_CLONE_ONLY_NO_LEDGER_WRITE');
 }else if(mode==='--run'){
  assert.equal(sql(clone,"SELECT to_regclass('public.fnb_cashier_shifts') IS NOT NULL AND to_regclass('floor_private.fnb723_fixture') IS NULL;"),'t','phase consumed or candidate missing; do not reset');
  const actor=randomUUID(),club=randomUUID(),menu=randomUUID(),ingredient=randomUUID();
  sql(clone,`BEGIN;CREATE TABLE floor_private.fnb723_fixture(fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb723_fixture ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON floor_private.fnb723_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','LOCAL723 concurrency TEST','TEST','approved');
   INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES('${ingredient}','${club}','LOCAL723 ingredient','unit',20,1000);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL723 item',5000,true,true);
   INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
   INSERT INTO floor_private.fnb723_fixture VALUES(jsonb_build_object('test_only',true,'actor','${actor}','club','${club}','menu','${menu}','ingredient','${ingredient}','state','started'));COMMIT;`);
  assert.equal(sql(clone,`SELECT count(*) FROM public.game_tables WHERE club_id='${club}';`),'100');
  const orders=[];for(let i=0;i<5;i++){
   const result=parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_create_order('${club}','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'${randomUUID()}');COMMIT;`));
   assert.equal(result.status,'ok');orders.push(result.order_id);
  }
  sql(clone,`UPDATE floor_private.fnb723_fixture SET fixture=fixture||jsonb_build_object('orders',${quote(JSON.stringify(orders))}::jsonb);`);
  const open=key=>{const r=parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_open_shift('${club}',0,'${key}');COMMIT;`));assert.equal(r.status,'ok');return r.shift_id;};
  const pay=order=>`SELECT public.fnb_mark_paid('${order}','${randomUUID()}');`;
  const refund=order=>`SELECT public.fnb_cancel_order('${order}','LOCAL723 TEST compensating refund');`;
  const close=(shift,count,key)=>`SELECT public.fnb_close_shift('${shift}',${count},'LOCAL723 TEST','${key}');`;
  const report=shift=>parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_get_shift_report('${shift}');ROLLBACK;`));
  const shiftA=open('723-open-a');
  const a=await overlap('pay-before-close',actor,pay(orders[0]),close(shiftA,5000,'723-close-a'));
  assert.equal(a.first.status,'ok');assert.equal(a.second.expected_cash_vnd,5000);assert.equal(a.second.variance_vnd,0);
  const frozenA=report(shiftA);
  const shiftB=open('723-open-b');
  const b=await overlap('close-before-pay-gap',actor,close(shiftB,0,'723-close-b'),pay(orders[1]));
  assert.equal(b.first.expected_cash_vnd,0);assert.equal(b.second.status,'ok');
  assert.equal(sql(clone,`SELECT shift_id IS NULL FROM floor_private.fnb_shift_order_events722 WHERE order_id='${orders[1]}' AND kind='sale';`),'t');
  assert.equal(report(shiftB).sales_vnd,0);
  const shiftC=open('723-open-c');
  assert.equal(parse(sql(clone,`BEGIN;${auth(actor)}${pay(orders[2])}COMMIT;`)).status,'ok');
  const c=await overlap('refund-before-close',actor,refund(orders[2]),close(shiftC,0,'723-close-c'));
  assert.equal(c.first.status,'ok');assert.equal(c.second.sales_vnd,5000);assert.equal(c.second.refunds_vnd,5000);assert.equal(c.second.expected_cash_vnd,0);
  const shiftD=open('723-open-d');
  assert.equal(parse(sql(clone,`BEGIN;${auth(actor)}${pay(orders[3])}COMMIT;`)).status,'ok');
  const d=await overlap('close-and-new-open-before-refund',actor,close(shiftD,5000,'723-close-d')+`SELECT public.fnb_open_shift('${club}',0,'723-open-e');`,refund(orders[3]));
  assert.equal(d.first.expected_cash_vnd,5000);assert.equal(d.second.status,'ok');
  const shiftE=sql(clone,`SELECT id FROM public.fnb_cashier_shifts WHERE club_id='${club}' AND status='open';`);
  assert.equal(report(shiftD).refunds_vnd,0);assert.equal(report(shiftE).refunds_vnd,5000);
  assert.equal(sql(clone,`SELECT shift_id='${shiftE}'::uuid FROM floor_private.fnb_shift_order_events722 WHERE order_id='${orders[3]}' AND kind='refund';`),'t');
  assert.deepEqual(report(shiftA),frozenA);
  assert.equal(parse(sql(clone,`BEGIN;${auth(actor)}${close(shiftE,0,'723-close-e')}COMMIT;`)).variance_vnd,5000);
  const concurrent=await overlap('concurrent-two-open-intents',actor,`SELECT public.fnb_open_shift('${club}',0,'723-concurrent-a');`,`SELECT public.fnb_open_shift('${club}',0,'723-concurrent-b');`);
  assert.equal(concurrent.first.shift_id,concurrent.second.shift_id);assert.equal(concurrent.second.already_open,true);
  // RR writes fail atomically rather than attributing to an old MVCC view after admission.
  sql(clone,`BEGIN ISOLATION LEVEL REPEATABLE READ;${auth(actor)}DO $$ BEGIN
   BEGIN PERFORM public.fnb_mark_paid('${orders[4]}','723-rr');RAISE EXCEPTION 'RR unexpectedly committed';
   EXCEPTION WHEN serialization_failure THEN ASSERT SQLERRM='FNB_SHIFT_READ_COMMITTED_REQUIRED';END;
   END $$;ROLLBACK;`);
  assert.equal(sql(clone,`SELECT status='pending' AND paid_at IS NULL FROM public.fnb_orders WHERE id='${orders[4]}';`),'t');
  assert.equal(sql(clone,`SELECT count(*) FROM floor_private.fnb_shift_order_events722 WHERE order_id='${orders[4]}';`),'0');
  assert.equal(sql(clone,`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'16');
  assert.equal(sql(clone,`SELECT count(*)||'|'||sum(delta) FROM public.fnb_stock_movements WHERE ref_id IN(${orders.map(quote).join(',')});`),'6|-4');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_cashier_shifts WHERE club_id='${club}' AND status='open';`),'1');
  sql(clone,`UPDATE floor_private.fnb723_fixture SET fixture=fixture||jsonb_build_object('state','qualified','shifts',${quote(JSON.stringify([shiftA,shiftB,shiftC,shiftD,shiftE,concurrent.first.shift_id]))}::jsonb);`);
  console.log('FNB723_TRUE_ACTUAL_SHIFT_RPC_TWO_ORDERINGS_OPEN_REPLAY_RR_STOCK_PASS',JSON.stringify({club,actor,ingredient,orders,shifts:[shiftA,shiftB,shiftC,shiftD,shiftE,concurrent.first.shift_id]}));
 }else if(mode==='--bank724'){
  assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb724_fixture') IS NULL AND (SELECT fixture->>'state' FROM floor_private.fnb723_fixture)='qualified';"),'t','bank phase consumed or prerequisite not qualified; do not reset');
  const actor=randomUUID(),cashier=randomUUID(),club=randomUUID(),menu=randomUUID(),ingredient=randomUUID();
  const token=`LOCAL724-${randomUUID()}`,account=`TEST-NON-BANK724-${randomUUID()}`;
  sql(clone,`BEGIN;CREATE TABLE floor_private.fnb724_fixture(fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb724_fixture ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON floor_private.fnb724_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO auth.users(id) VALUES('${actor}'),('${cashier}');
   INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','LOCAL724 bank-overlap TEST','TEST','approved');
   INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES('${club}','${cashier}','cashier');
   INSERT INTO public.fnb_settings(club_id,guest_order_enabled,guest_bank_auto_confirm) VALUES('${club}',true,true);
   INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active)
    SELECT '${club}',id,'${token}',true FROM public.game_tables WHERE club_id='${club}' AND table_number=30;
   INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active,account_type)
    VALUES('${club}','LOCAL724 NOT A BANK','${account}','NO REAL ACCOUNT',true,'escrow');
   INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES('${ingredient}','${club}','LOCAL724 ingredient','unit',12,1000);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL724 item',5000,true,true);
   INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
   INSERT INTO floor_private.fnb724_fixture VALUES(jsonb_build_object('test_only',true,'actor','${actor}','cashier','${cashier}','club','${club}','menu','${menu}','ingredient','${ingredient}','state','started'));COMMIT;`);
  assert.equal(sql(clone,`SELECT count(*) FROM public.game_tables WHERE club_id='${club}';`),'100');
  const orders=[],banks=[];
  for(let i=0;i<2;i++){
   const order=parse(sql(clone,`BEGIN;SET LOCAL ROLE anon;SELECT public.fnb_guest_create_order('${token}',3::smallint,'LOCAL724 TEST',NULL,
    jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'bank_transfer','${randomUUID()}');COMMIT;`));
   assert.equal(order.status,'ok');orders.push(order.order_id);const bank=randomUUID();banks.push(bank);
   sql(clone,`INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at)
    SELECT '${bank}','sepay','LOCAL724-${bank}','${account}','${club}',5000,'in',reference_code,clock_timestamp() FROM public.fnb_orders WHERE id='${order.order_id}';`);
  }
  sql(clone,`UPDATE public.fnb_menu_items SET price_vnd=9000 WHERE id='${menu}';
   UPDATE floor_private.fnb724_fixture SET fixture=fixture||jsonb_build_object('orders',${quote(JSON.stringify(orders))}::jsonb,'banks',${quote(JSON.stringify(banks))}::jsonb);`);
  const service="RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{\"role\":\"service_role\"}';SET LOCAL ROLE service_role;";
  const settle=bank=>`${service}SELECT public.settle_bank_transaction('${bank}',true);`;
  const close=(shift,key,count=0)=>`SELECT public.fnb_close_shift('${shift}',${count},'LOCAL724 TEST','${key}');`;
  const open=key=>{const r=parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_open_shift('${club}',0,'${key}');COMMIT;`));assert.equal(r.status,'ok');return r.shift_id;};
  const report=shift=>parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_get_shift_report('${shift}');ROLLBACK;`));
  const shiftA=open('724-open-a');
  const a=await overlap('service-bank-before-cashier-close',actor,settle(banks[0]),close(shiftA,'724-close-a'),cashier);
  assert.equal(a.first.outcome,'auto_confirmed');assert.equal(a.second.bank_paid_vnd,5000);assert.equal(a.second.expected_cash_vnd,0);assert.equal(a.second.variance_vnd,0);
  const frozenA=report(shiftA);
  const shiftB=open('724-open-b');
  const b=await overlap('close-and-new-open-before-service-bank',actor,close(shiftB,'724-close-b')+`SELECT public.fnb_open_shift('${club}',0,'724-open-c');`,settle(banks[1]));
  assert.equal(b.first.bank_paid_vnd,0);assert.equal(b.second.outcome,'auto_confirmed');
  const shiftC=sql(clone,`SELECT id FROM public.fnb_cashier_shifts WHERE club_id='${club}' AND status='open';`);
  assert.equal(report(shiftB).bank_paid_vnd,0);assert.equal(report(shiftC).bank_paid_vnd,5000);assert.equal(report(shiftC).expected_drawer_vnd,0);
  assert.deepEqual(report(shiftA),frozenA);
  for(const bank of banks){const replay=parse(sql(clone,`BEGIN;${settle(bank)}COMMIT;`));assert.equal(replay.already_settled,true);assert.equal(replay.outcome,'auto_confirmed');}
  assert.equal(parse(sql(clone,`BEGIN;${auth(cashier)}${close(shiftC,'724-close-c')}COMMIT;`)).variance_vnd,0);
  const twoActors=await overlap('owner-vs-cashier-concurrent-open',actor,`SELECT public.fnb_open_shift('${club}',0,'724-open-owner');`,`SELECT public.fnb_open_shift('${club}',0,'724-open-cashier');`,cashier);
  assert.equal(twoActors.first.shift_id,twoActors.second.shift_id);assert.equal(twoActors.second.already_open,true);
  const shiftD=twoActors.first.shift_id;
  const conflict=await overlap('same-actor-key-different-count-conflict',actor,close(shiftD,'724-close-conflict',0),close(shiftD,'724-close-conflict',1));
  assert.equal(conflict.first.status,'ok');assert.equal(conflict.second.error,'REQUEST_ID_CONFLICT');assert.equal(report(shiftD).shift.counted_cash_vnd,0);
  assert.equal(sql(clone,`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`),'8');
  assert.equal(sql(clone,`SELECT count(*)||'|'||sum(delta) FROM public.fnb_stock_movements WHERE ref_id IN(${orders.map(quote).join(',')});`),'2|-4');
  assert.equal(sql(clone,`SELECT count(*) FROM public.payment_settlements WHERE bank_transaction_id IN(${banks.map(quote).join(',')}) AND outcome='auto_confirmed';`),'2');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_orders WHERE id IN(${orders.map(quote).join(',')}) AND subtotal_vnd=5000 AND cogs_vnd=2000 AND status='paid';`),'2');
  sql(clone,`UPDATE floor_private.fnb724_fixture SET fixture=fixture||jsonb_build_object('state','qualified','shifts',${quote(JSON.stringify([shiftA,shiftB,shiftC,shiftD]))}::jsonb);`);
  console.log('FNB724_ACTUAL_SERVICE_PARENT_CLOSE_BOTH_ORDERINGS_TWO_ACTOR_OPEN_KEY_CONFLICT_PASS',JSON.stringify({club,actor,cashier,ingredient,orders,banks,shifts:[shiftA,shiftB,shiftC,shiftD]}));
 }else if(mode==='--intent725-install'){
  assert.equal(sql(clone,"SELECT to_regprocedure('public.fnb_open_shift_v2(uuid,bigint,text,uuid)') IS NULL AND (SELECT fixture->>'state' FROM floor_private.fnb724_fixture)='qualified';"),'t','intent installation consumed or prerequisite missing');
  sql(clone,`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';SET LOCAL test.fnb725_clone='on';${readFileSync('tests/cashier/fnb725.intent-recovery.candidate.sql','utf8')}COMMIT;`);
  console.log('FNB725_ACTOR_BOUND_LOOKUP_CANCEL_INSTALLED_OWNED_CLONE_ONLY');
 }else if(mode==='--intent726'){
  assert.equal(sql(clone,"SELECT to_regprocedure('public.fnb_open_shift_v2(uuid,bigint,text,uuid)') IS NOT NULL AND to_regclass('floor_private.fnb726_fixture') IS NULL;"),'t','intent726 constructor consumed or prerequisite missing');
  const actor=randomUUID(),cashier=randomUUID(),club=randomUUID();
  sql(clone,`BEGIN;CREATE TABLE floor_private.fnb726_fixture(fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb726_fixture ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON floor_private.fnb726_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO auth.users(id) VALUES('${actor}'),('${cashier}');
   INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','LOCAL726 recovery-concurrency TEST','TEST','approved');
   INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES('${club}','${cashier}','cashier');
   INSERT INTO floor_private.fnb726_fixture VALUES(jsonb_build_object('test_only',true,'actor','${actor}','cashier','${cashier}','club','${club}','state','started'));COMMIT;`);
  assert.equal(sql(clone,`SELECT count(*) FROM public.game_tables WHERE club_id='${club}';`),'100');
  const open=key=>`SELECT public.fnb_open_shift_v2('${club}',0,'${key}','${actor}');`;
  const close=(shift,key)=>`SELECT public.fnb_close_shift_v2('${shift}',0,NULL,'${key}','${actor}');`;
  const cancel=(op,shift,key)=>`SELECT public.fnb_cancel_shift_intent_v1('${club}','${op}',${shift?quote(shift):'NULL'},0,NULL,'${key}','${actor}');`;
  const read=key=>parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_get_shift_intent_v1('${club}','${key}','${actor}');ROLLBACK;`));
  const cancelledOpen=await overlap('cancel-before-late-open-v2',actor,cancel('open',null,'726-cancel-open'),open('726-cancel-open'));
  assert.equal(cancelledOpen.first.status,'cancelled');assert.equal(cancelledOpen.second.status,'cancelled');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_cashier_shifts WHERE club_id='${club}';`),'0');
  const appliedOpen=await overlap('committed-open-before-cancel',actor,open('726-applied-open'),cancel('open',null,'726-applied-open'));
  assert.equal(appliedOpen.first.status,'ok');assert.deepEqual(appliedOpen.second,appliedOpen.first);const shift=appliedOpen.first.shift_id;
  const cancelledClose=await overlap('cancel-before-late-close-v2',actor,cancel('close',shift,'726-cancel-close'),close(shift,'726-cancel-close'));
  assert.equal(cancelledClose.first.status,'cancelled');assert.equal(cancelledClose.second.status,'cancelled');
  assert.equal(sql(clone,`SELECT status FROM public.fnb_cashier_shifts WHERE id='${shift}';`),'open');
  const appliedClose=await overlap('committed-close-before-cancel',actor,close(shift,'726-applied-close'),cancel('close',shift,'726-applied-close'));
  assert.equal(appliedClose.first.status,'ok');assert.deepEqual(appliedClose.second,appliedClose.first);
  assert.equal(read('726-applied-close').result.status,'ok');assert.equal(read('726-cancel-close').result.status,'cancelled');
  const revoke=await overlap('cashier-revoked-while-waiting-admission',actor,
   cancel('open',null,'726-revoke-barrier')+`RESET ROLE;DELETE FROM public.club_fnb_staff WHERE club_id='${club}' AND user_id='${cashier}' AND kind='cashier';`,
   `DO $$ BEGIN BEGIN PERFORM public.fnb_open_shift_v2('${club}',0,'726-revoked-open','${cashier}');RAISE EXCEPTION 'revoked cashier committed';
    EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='Forbidden',SQLERRM;END;END $$;SELECT jsonb_build_object('denied','Forbidden');`,cashier);
  assert.equal(revoke.second.denied,'Forbidden');
  assert.equal(sql(clone,`SELECT count(*) FROM floor_private.fnb_shift_intents722 WHERE actor='${cashier}' AND request_id='726-revoked-open';`),'0');
  // A not_found read while the writer is uncommitted is not a cancellation fence.
  const a=session(`fnb726_read_${randomUUID().slice(0,8)}`);
  let unknownShift;
  try{
   a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='20s';${auth(actor)}${open('726-unknown-open')}SELECT 'FNB726_UNCOMMITTED_WRITE';\n`);
   await until(()=>a.output().includes('FNB726_UNCOMMITTED_WRITE'),[a]);
   assert.equal(read('726-unknown-open').status,'not_found');
   a.child.stdin.end('COMMIT;\n');const result=parse(await a.closed);assert.equal(result.status,'ok');unknownShift=result.shift_id;
   const found=read('726-unknown-open');assert.equal(found.status,'found');assert.equal(found.result.shift_id,unknownShift);
  }finally{
   if(!a.child.stdin.destroyed&&!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([a.closed]);
  }
  assert.equal(parse(sql(clone,`BEGIN;${auth(actor)}${close(unknownShift,'726-close-unknown')}COMMIT;`)).status,'ok');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_cashier_shifts WHERE club_id='${club}' AND status='closed';`),'2');
  sql(clone,`UPDATE floor_private.fnb726_fixture SET fixture=fixture||jsonb_build_object('state','qualified','shifts',${quote(JSON.stringify([shift,unknownShift]))}::jsonb);`);
  console.log('FNB726_CANCEL_APPLY_BOTH_ORDERINGS_ROLE_RECHECK_AND_INFLIGHT_NOT_FOUND_PASS',JSON.stringify({club,actor,cashier,shifts:[shift,unknownShift]}));
 }else if(mode==='--rr738-fix'){
  sql(clone,readFileSync('tests/cashier/fnb738.rr-guard.clone.sql','utf8'));
  console.log('FNB738_RR_GUARD_CANDIDATE_REVISION_INSTALLED_ONLY_OWNED_CLONE_PRIVATE_PRE_RR_BACKUP');
 }else if(mode==='--rr738-fixed'){
  assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb738_fixed_fixture') IS NULL;"),'t','RR fixed constructor consumed');
  const actor=randomUUID(),club=randomUUID(),menu=randomUUID(),key='738-fixed-create-first';
  sql(clone,`BEGIN;CREATE TABLE floor_private.fnb738_fixed_fixture(fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb738_fixed_fixture ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.fnb738_fixed_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO public.clubs(id,owner_id,name,region,status,bot_enabled) VALUES('${club}','${actor}','LOCAL738 RR fixed TEST','TEST','approved',false);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL738 fixed item',5000,true,false);
   INSERT INTO floor_private.fnb738_fixed_fixture VALUES(jsonb_build_object('test_only',true,'actor','${actor}','club','${club}','menu','${menu}','key','${key}','state','started'));COMMIT;`);
  const lines=[{menu_item_id:menu,qty:1}],payload={source:'counter',table:null,customer:null,note:null,lines,table_ref:null,player_ref:null};
  const call=`public.fnb_create_order('${club}','counter',NULL,NULL,NULL,${quote(JSON.stringify(lines))}::jsonb,'${key}',NULL,NULL)`;
  const cancel=`public.fnb_cancel_create_intent_v1('${club}','${key}','${actor}','order',${quote(JSON.stringify(payload))}::jsonb)`;
  const caught=expression=>`DO $capture$ DECLARE response jsonb;BEGIN response:=${expression};PERFORM set_config('test.fnb738_result',response::text,true);
   EXCEPTION WHEN serialization_failure THEN PERFORM set_config('test.fnb738_result',jsonb_build_object('error',SQLERRM,'code',SQLSTATE)::text,true);END $capture$;SELECT current_setting('test.fnb738_result')::jsonb;`;
  const a=session(`fnb738_${randomUUID().slice(0,8)}_a`),b=session(`fnb738_${randomUUID().slice(0,8)}_b`);let first,second;
  try{
   a.child.stdin.write(`SET application_name='${a.name}';BEGIN;${auth(actor)}SELECT ${call};SELECT 'FNB738_CREATE_HELD';\n`);
   await until(()=>a.output().includes('FNB738_CREATE_HELD'),[a]);
   b.child.stdin.end(`BEGIN ISOLATION LEVEL REPEATABLE READ;${auth(actor)}${caught(cancel)}COMMIT;\n`);
   second=parse(await b.closed);assert.equal(second.code,'40001');assert.equal(a.terminal(),false,'creator stays held while RR cancel fails before lock');
   a.child.stdin.end('COMMIT;\n');first=parse(await a.closed);
  }finally{for(const worker of [a,b])if(!worker.child.stdin.destroyed&&!worker.child.stdin.writableEnded)worker.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([a.closed,b.closed]);}
  const current=parse(sql(clone,`BEGIN;${auth(actor)}SELECT public.fnb_get_create_receipt_v1('${club}','${key}','${actor}');COMMIT;`));
  assert.equal(current.status,'found');assert.equal(current.order.id,first.order_id);
  const writeKey='738-fixed-RR-writer';
  const denied=await overlap('RR-writer-after-key-wait',actor,`SELECT pg_advisory_xact_lock(hashtextextended('${club}:${writeKey}',0));SELECT jsonb_build_object('status','key_held');`,caught(call.replaceAll(key,writeKey)),actor,'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
  assert.equal(denied.second.code,'40001');
  assert.equal(sql(clone,`SELECT count(*) FROM floor_private.fnb_create_cancel_fences_v1 WHERE club_id='${club}';`),'0');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_orders WHERE club_id='${club}';`),'1');
  assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_create_intents_v1 WHERE club_id='${club}';`),'1');
  sql(clone,`UPDATE floor_private.fnb738_fixed_fixture SET fixture=fixture||jsonb_build_object('state','qualified','creator',${quote(JSON.stringify(first))}::jsonb,'rr_cancel',${quote(JSON.stringify(second))}::jsonb,'rr_writer',${quote(JSON.stringify(denied.second))}::jsonb);`);
  console.log('FNB738_RR_CANCEL_PREWAIT_DENIED_RC_RECEIPT_FOUND_RR_WRITER_POSTWAIT_DENIED_NO_FALSE_FENCE_PASS',JSON.stringify({club,first,second,writer:denied.second}));
 }else if(mode==='--cancel738-rr-baseline'){
  assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb738_rr_fixture') IS NULL;"),'t','RR baseline consumed');
  const actor=randomUUID(),club=randomUUID(),menu=randomUUID(),key='738-RR-cancel';
  sql(clone,`BEGIN;CREATE TABLE floor_private.fnb738_rr_fixture(fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb738_rr_fixture ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.fnb738_rr_fixture FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO public.clubs(id,owner_id,name,region,status,bot_enabled) VALUES('${club}','${actor}','LOCAL738 RR baseline TEST','TEST','approved',false);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL738 item',5000,true,false);
   INSERT INTO floor_private.fnb738_rr_fixture VALUES(jsonb_build_object('test_only',true,'actor','${actor}','club','${club}','menu','${menu}','key','${key}','state','started'));COMMIT;`);
  const lines=[{menu_item_id:menu,qty:1}],payload={source:'counter',table:null,customer:null,note:null,lines,table_ref:null,player_ref:null};
  const result=await overlap('repeatable-read-cancel-after-committed-create',actor,
   `SELECT public.fnb_create_order('${club}','counter',NULL,NULL,NULL,${quote(JSON.stringify(lines))}::jsonb,'${key}',NULL,NULL);`,
   `SELECT public.fnb_cancel_create_intent_v1('${club}','${key}','${actor}','order',${quote(JSON.stringify(payload))}::jsonb);`,actor,"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;");
  sql(clone,`UPDATE floor_private.fnb738_rr_fixture SET fixture=fixture||jsonb_build_object('state','observed','result',${quote(JSON.stringify(result))}::jsonb);`);
  console.log('FNB738_RR_BASELINE_RESULT',JSON.stringify({club,result}));
  assert.equal(result.second.status,'found','snapshot-stale cancellation must not falsely fence a committed order');
 }else if(mode==='--cancel737-install'){
  assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb737_release_backup') IS NULL AND to_regprocedure('public.fnb_get_create_receipt_v1(uuid,text,uuid)') IS NULL;"),'t','install consumed; preserve clone');
  const files=['supabase/migrations/20270128000282_fnb_create_receipt_read_v1.sql','supabase/migrations/20270128000283_fnb_create_cancel_fence_v1.sql'];
  const migrations=files.map(file=>{const value=readFileSync(file,'utf8');assert.equal((value.match(/^BEGIN;\r?$/gm)||[]).length,1);assert.equal((value.match(/^COMMIT;\r?$/gm)||[]).length,1);return value.replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\r?\n?/m,'');});
  sql(clone,`BEGIN;${migrations[0]}
   CREATE TABLE floor_private.fnb737_release_backup AS SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig FROM pg_proc WHERE oid IN('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure,'public.fnb_get_create_receipt_v1(uuid,text,uuid)'::regprocedure);
   ALTER TABLE floor_private.fnb737_release_backup ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.fnb737_release_backup FROM PUBLIC,anon,authenticated,service_role;
   ${migrations[1]}COMMIT;`);
  console.log('FNB737_EXACT282_283_INSTALLED_OWNED_CLONE_ONLY_PRIVATE_BACKUP_NO_LEDGER');
 }else if(mode==='--cancel737-run'||mode==='--cancel739-final'){
  const fixtureTable=mode==='--cancel739-final'?'fnb739_final_fixture':'fnb737_fixture';
  assert.equal(sql(clone,`SELECT to_regclass('floor_private.${fixtureTable}') IS NULL AND to_regclass('floor_private.fnb737_release_backup') IS NOT NULL;`),'t','constructor consumed or install missing');
  if(mode==='--cancel739-final')assert.equal(sql(clone,"SELECT md5(pg_get_functiondef('public._fnb_bind_create_intent_v1(uuid,uuid,text,text,jsonb)'::regprocedure));"),'2f4a64f991f4f2b2caf0b10002cdf93c');
  const actor=randomUUID(),cancelCashier=randomUUID(),compCashier=randomUUID(),club=randomUUID(),menu=randomUUID(),ingredient=randomUUID();
  sql(clone,`BEGIN;CREATE TABLE floor_private.${fixtureTable}(fixture jsonb NOT NULL);ALTER TABLE floor_private.${fixtureTable} ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.${fixtureTable} FROM PUBLIC,anon,authenticated,service_role;
   INSERT INTO auth.users(id) VALUES('${actor}'),('${cancelCashier}'),('${compCashier}');INSERT INTO public.clubs(id,owner_id,name,region,status,bot_enabled) VALUES('${club}','${actor}','LOCAL737 cancellation concurrency TEST','TEST','approved',false);
   INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES('${club}','${cancelCashier}','cashier'),('${club}','${compCashier}','cashier');
   INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES('${ingredient}','${club}','LOCAL737 ingredient','unit',10,1000);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL737 item',5000,true,true);
   INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
   INSERT INTO floor_private.${fixtureTable} VALUES(jsonb_build_object('test_only',true,'actor','${actor}','cancel_cashier','${cancelCashier}','comp_cashier','${compCashier}','club','${club}','menu','${menu}','ingredient','${ingredient}','state','started'));COMMIT;`);
  const lines=[{menu_item_id:menu,qty:1}],results=[];
  const payload=operation=>({source:'counter',table:null,customer:null,note:null,lines,...(operation==='order'?{table_ref:null,player_ref:null}:{reason:'LOCAL737 TEST'})});
  const create=(operation,key)=>`SELECT ${operation==='order'?`public.fnb_create_order('${club}','counter',NULL,NULL,NULL,${quote(JSON.stringify(lines))}::jsonb,'${key}',NULL,NULL)`:`public.fnb_create_comp_order('${club}','counter',NULL,NULL,NULL,${quote(JSON.stringify(lines))}::jsonb,'LOCAL737 TEST','${key}')`};`;
  const cancel=(operation,key,who=actor)=>`SELECT public.fnb_cancel_create_intent_v1('${club}','${key}','${who}','${operation}',${quote(JSON.stringify(payload(operation)))}::jsonb);`;
  for(const operation of ['order','comp']){
   const cancelledKey=`737-${operation}-cancel-first`,committedKey=`737-${operation}-create-first`;
   const cancelled=await overlap(`cancel-first-${operation}`,actor,cancel(operation,cancelledKey),create(operation,cancelledKey));
   assert.equal(cancelled.first.status,'cancelled');assert.equal(cancelled.second.error,'REQUEST_ID_CONFLICT');
   const committed=await overlap(`create-first-${operation}`,actor,create(operation,committedKey),cancel(operation,committedKey));
   assert.equal(committed.first.status,'ok');assert.equal(committed.second.status,'found');assert.equal(committed.second.order.id,committed.first.order_id);
   results.push({operation,cancelled,committed});
  }
  // Each worker catches only a server denial so the native session can expose the exact result.
  for(const [kind,who,statement] of [['cancel',cancelCashier,cancel('order','737-revoked-cancel',cancelCashier)],['comp',compCashier,create('comp','737-revoked-comp')]]){
   const key=kind==='cancel'?'737-revoked-cancel':'737-revoked-comp';
   const expression=statement.trim().replace(/^SELECT /,'').replace(/;$/,'');
   const caught=`DO $capture$ DECLARE response jsonb;BEGIN response:=${expression};PERFORM set_config('test.fnb737_result',response::text,true);
    EXCEPTION WHEN raise_exception THEN PERFORM set_config('test.fnb737_result',jsonb_build_object('error',SQLERRM)::text,true);END $capture$;SELECT current_setting('test.fnb737_result')::jsonb;`;
   const denied=await overlap(`revoked-during-key-wait-${kind}`,actor,`SELECT pg_advisory_xact_lock(hashtextextended('${club}:${key}',0));RESET ROLE;DELETE FROM public.club_fnb_staff WHERE club_id='${club}' AND user_id='${who}';SELECT jsonb_build_object('status','held_role_revoked');`,caught,who);
   assert.equal(denied.second.error,'Forbidden');results.push({kind,denied});
  }
  const facts=parse(sql(clone,`SELECT jsonb_build_object('orders',(SELECT count(*) FROM public.fnb_orders WHERE club_id='${club}'),'intents',(SELECT count(*) FROM public.fnb_create_intents_v1 WHERE club_id='${club}'),'fences',(SELECT count(*) FROM floor_private.fnb_create_cancel_fences_v1 WHERE club_id='${club}'),'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}'),'movements',(SELECT count(*) FROM public.fnb_stock_movements WHERE ingredient_id='${ingredient}'));`));
  assert.deepEqual(facts,{orders:2,intents:2,fences:2,stock:8,movements:1});
  sql(clone,`UPDATE floor_private.${fixtureTable} SET fixture=fixture||jsonb_build_object('state','qualified','results',${quote(JSON.stringify(results))}::jsonb,'facts',${quote(JSON.stringify(facts))}::jsonb);`);
  console.log('FNB737_TRUE_OVERLAP_BOTH_OPERATIONS_BOTH_ORDERINGS_CANCEL_AND_COMP_POST_WAIT_ROLE_PASS',JSON.stringify({club,facts}));
 }else if(mode==='--create734-fix'){
  assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb734_create_backup') IS NULL AND EXISTS(SELECT 1 FROM floor_private.fnb734_fixtures WHERE phase='baseline');"),'t','fix constructor consumed or missing baseline');
  const migration=readFileSync('supabase/migrations/20270128000281_fnb_create_recovery_ordering_v1.sql','utf8');
  assert.equal((migration.match(/^BEGIN;\r?$/gm)||[]).length,1);assert.equal((migration.match(/^COMMIT;\r?$/gm)||[]).length,1);
  sql(clone,`BEGIN;CREATE TABLE floor_private.fnb734_create_backup AS SELECT pg_get_functiondef(oid) AS definition,proowner,proacl,proconfig FROM pg_proc WHERE proname='fnb_create_order' AND pronamespace='public'::regnamespace;
   ALTER TABLE floor_private.fnb734_create_backup ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.fnb734_create_backup FROM PUBLIC,anon,authenticated,service_role;
   ${migration.replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\r?\n?/m,'')}COMMIT;`);
  console.log('FNB734_EXACT281_CREATE_RECOVERY_INSTALLED_OWNED_CLONE_ONLY_PRIVATE_BACKUP');
 }else if(mode.startsWith('--create734-')||mode==='--comp737-key-baseline'){
  const compKey=mode==='--comp737-key-baseline',phase=compKey?'comp-key-baseline':mode==='--create734-baseline'?'baseline':'fixed';
  if(compKey){
   assert.equal(sql(clone,"SELECT count(*) FROM floor_private.fnb734_fixtures WHERE phase='comp-key-baseline';"),'0','737 baseline consumed');
   assert.equal(sql(clone,"SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='_fnb_bind_create_intent_v1' AND pronamespace='public'::regnamespace;"),'83e587313eae6e15d665f5254e9467ef');
  }else if(phase==='baseline'){
   assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb734_fixtures') IS NULL;"),'t','baseline constructor consumed; preserve evidence');
   assert.equal(sql(clone,"SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='fnb_create_order' AND pronamespace='public'::regnamespace;"),'60212b28a72941f81499d72d1aaa92f3');
   sql(clone,'CREATE TABLE floor_private.fnb734_fixtures(phase text PRIMARY KEY,fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb734_fixtures ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.fnb734_fixtures FROM PUBLIC,anon,authenticated,service_role;');
  }else{
   assert.equal(sql(clone,"SELECT count(*) FROM floor_private.fnb734_fixtures WHERE phase='fixed';"),'0','fixed constructor consumed');
   assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb734_create_backup') IS NOT NULL;"),'t');
  }
  const actor=randomUUID(),cashier=randomUUID(),club=randomUUID(),menu=randomUUID(),ingredient=randomUUID(),key='734-create';
  sql(clone,`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}'),('${cashier}');
   INSERT INTO public.clubs(id,owner_id,name,region,status,bot_enabled) VALUES('${club}','${actor}','LOCAL734 ${phase} authority TEST','TEST','approved',false);
   INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES('${club}','${cashier}','cashier');
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL734 item',5000,true,false);
   INSERT INTO floor_private.fnb734_fixtures VALUES('${phase}',jsonb_build_object('test_only',true,'actor','${actor}','cashier','${cashier}','club','${club}','menu','${menu}','state','started'));COMMIT;`);
  if(compKey)sql(clone,`BEGIN;INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES('${ingredient}','${club}','LOCAL737 key race ingredient','unit',10,1000);
   UPDATE public.fnb_menu_items SET tracks_inventory=true WHERE id='${menu}';INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
   UPDATE floor_private.fnb734_fixtures SET fixture=fixture||jsonb_build_object('ingredient','${ingredient}') WHERE phase='${phase}';COMMIT;`);
  const call=compKey?`public.fnb_create_comp_order('${club}','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'LOCAL737 key race TEST','${key}')`
   :`public.fnb_create_order('${club}','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'${key}',NULL,NULL)`;
  const second=`DO $capture$ DECLARE response jsonb;BEGIN response:=${call};PERFORM set_config('test.fnb734_result',response::text,true);
   EXCEPTION WHEN raise_exception THEN PERFORM set_config('test.fnb734_result',jsonb_build_object('error',SQLERRM)::text,true);END $capture$;
   SELECT current_setting('test.fnb734_result')::jsonb;`;
  const result=await overlap(`create-role-revoked-during-request-key-wait-${phase}`,actor,
   `SELECT pg_advisory_xact_lock(hashtextextended('${club}:${key}',0));RESET ROLE;DELETE FROM public.club_fnb_staff WHERE club_id='${club}' AND user_id='${cashier}';SELECT jsonb_build_object('status','key_held_role_revoked');`,second,cashier);
  const counts=parse(sql(clone,`SELECT jsonb_build_object('orders',(SELECT count(*) FROM public.fnb_orders WHERE club_id='${club}'),'intents',(SELECT count(*) FROM public.fnb_create_intents_v1 WHERE club_id='${club}'),'movements',(SELECT count(*) FROM public.fnb_stock_movements WHERE club_id='${club}'));`));
  sql(clone,`UPDATE floor_private.fnb734_fixtures SET fixture=fixture||jsonb_build_object('state','observed','result',${quote(JSON.stringify(result.second))}::jsonb,'counts',${quote(JSON.stringify(counts))}::jsonb) WHERE phase='${phase}';`);
  console.log('FNB734_ACTUAL_AUTH_WAIT_RESULT',JSON.stringify({phase,club,result:result.second,counts}));
  assert.equal(result.second.error,'Forbidden','revoked cashier must not create an order after request-key wait');
  assert.deepEqual(counts,{orders:0,intents:0,movements:0});
  console.log('FNB734_FIXED_POST_WAIT_AUTH_NO_ORDER_INTENT_STOCK_PASS');
 }else if(mode==='--comp728-fix'){
  sql(clone,`BEGIN;SET LOCAL test.fnb728_clone='on';${readFileSync('tests/cashier/fnb728.comp-role-recheck.candidate.sql','utf8')}COMMIT;`);
  console.log('FNB728_COMP_POST_GATE_ROLE_RECHECK_INSTALLED_OWNED_CLONE_ONLY');
 }else{
  const phase=mode==='--comp728-baseline'?'baseline':'fixed';
  if(phase==='baseline'){
   assert.equal(sql(clone,"SELECT to_regclass('floor_private.fnb728_fixtures') IS NULL;"),'t','baseline constructor consumed');
   sql(clone,'CREATE TABLE floor_private.fnb728_fixtures(phase text PRIMARY KEY,fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb728_fixtures ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.fnb728_fixtures FROM PUBLIC,anon,authenticated,service_role;');
  }else assert.equal(sql(clone,"SELECT count(*) FROM floor_private.fnb728_fixtures WHERE phase='fixed';"),'0','fixed constructor consumed');
  const actor=randomUUID(),cashier=randomUUID(),club=randomUUID(),menu=randomUUID(),ingredient=randomUUID();
  sql(clone,`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}'),('${cashier}');
   INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','LOCAL728 ${phase} TEST','TEST','approved');
   INSERT INTO public.club_fnb_staff(club_id,user_id,kind) VALUES('${club}','${cashier}','cashier');
   INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES('${ingredient}','${club}','LOCAL728 ${phase} ingredient','unit',10,1000);
   INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${menu}','${club}','LOCAL728 ${phase} item',5000,true,true);
   INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${club}','${menu}','${ingredient}',2);
   INSERT INTO floor_private.fnb728_fixtures VALUES('${phase}',jsonb_build_object('test_only',true,'actor','${actor}','cashier','${cashier}','club','${club}','ingredient','${ingredient}','menu','${menu}','state','started'));COMMIT;`);
  const result=await overlap(`comp-role-revoked-while-waiting-${phase}`,actor,
   `SELECT public.fnb_cancel_shift_intent_v1('${club}','open',NULL,0,NULL,'728-barrier','${actor}');RESET ROLE;DELETE FROM public.club_fnb_staff WHERE club_id='${club}' AND user_id='${cashier}' AND kind='cashier';`,
   `SELECT public.fnb_create_comp_order('${club}','counter',NULL,NULL,NULL,jsonb_build_array(jsonb_build_object('menu_item_id','${menu}','qty',1)),'LOCAL728 TEST','728-comp');`,cashier);
  const stock=Number(sql(clone,`SELECT on_hand FROM public.fnb_ingredients WHERE id='${ingredient}';`));
  sql(clone,`UPDATE floor_private.fnb728_fixtures SET fixture=fixture||jsonb_build_object('state','observed','result',${quote(JSON.stringify(result.second))}::jsonb,'stock',${stock}) WHERE phase='${phase}';`);
  console.log('FNB728_POST_WAIT_COMP_AUTHORIZATION_RESULT',JSON.stringify({phase,club,actor,cashier,ingredient,result:result.second,stock}));
  assert.equal(result.second.error,'Forbidden','revoked cashier must not create/pay a comp after admission wait');
  assert.equal(stock,10);assert.equal(sql(clone,`SELECT count(*) FROM public.fnb_orders WHERE club_id='${club}';`),'0');
  console.log('FNB728_FIXED_COMP_AUTH_AFTER_WAIT_NO_ORDER_STOCK_OR_INTENT_PASS');
 }
}finally{
 assert.equal(sourceProof(),beforeSource,'primary DB business/functions/authority must not change');
 assert.equal(failed720Proof(),before720,'original terminal720 bank evidence must not change');
 assert.equal(sql(clone,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid();"),'0');
 console.log('FNB723_PRIMARY_UNCHANGED_FAILED720_PRESERVED_NO_IDLE_TX');
}
