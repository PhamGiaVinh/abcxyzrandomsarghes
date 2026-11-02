import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
assert.equal(process.env.VINPOKER_FNB384_LOCAL,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure;"),'31b85897c490845913ab864bdfd5320c');
const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb384_fixture;'));
assert.equal(f.actor,'a364de8e-06b1-4428-a20d-ac614ec406e5');assert.equal(f.club,'349ecf35-50ba-4c71-a581-15dc45f1cd01');
for(const value of [f.order,f.ingredient,...f.lines])assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
assert.equal(f.lines.length,2);
assert.equal(sql(`SELECT line_status FROM public.fnb_order_items WHERE id='${f.lines[0]}' AND order_id='${f.order}';`),'paid','exact fresh first-line overlap only; never reset a completed fixture');
const filters={fnb_orders:`id<>'${f.order}'`,fnb_order_items:`order_id<>'${f.order}'`,fnb_order_events:`order_id<>'${f.order}'`,
 fnb_ingredients:`id<>'${f.ingredient}'`,fnb_menu_items:`id NOT IN(SELECT menu_item_id FROM public.fnb_order_items WHERE order_id='${f.order}')`,
 fnb_recipe_items:`menu_item_id NOT IN(SELECT menu_item_id FROM public.fnb_order_items WHERE order_id='${f.order}')`,fnb_stock_movements:`ref_id IS DISTINCT FROM '${f.order}'::uuid`,
 cashier_buyin_movements:'true',tournament_prize_payments:'true',notifications:'true'};
const other=()=>sql(`SELECT md5(jsonb_build_array(${Object.entries(filters).map(([table,where])=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.${table} t WHERE ${where})`).join(',')})::text);`);
const before=other();assert.equal(before,'aff064478c8c3cf2ba56a91cc6e72a5e','unrelated facts must match pre-fixture baseline');
function open(name){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',terminal=false;
 child.stdin.on('error',()=>{});child.stdout.on('data',value=>out+=value);child.stderr.on('data',value=>err+=value);
 const done=new Promise(resolve=>{child.once('error',error=>{terminal=true;resolve({code:-1,error:String(error)});});child.once('close',code=>{terminal=true;resolve({code,error:err});});});
 const send=query=>{assert.ok(!terminal&&!child.stdin.destroyed);child.stdin.write(query+'\n');};
 send(`SET application_name='fnb384-${name}';SET statement_timeout='10s';SET idle_in_transaction_session_timeout='20s';`);
 return {send,get out(){return out;},async until(marker){const end=Date.now()+12000;while(!out.includes(marker)){assert.ok(!terminal,err);assert.ok(Date.now()<end,`missing ${marker}: ${err}`);await delay(30);}},async close(){if(!terminal&&!child.stdin.destroyed)child.stdin.end('ROLLBACK;\n\\q\n');const result=await done;assert.equal(result.code,0,result.error);}};
}
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;`;
const command=tag=>`SELECT jsonb_build_object('tag','${tag}','result',public.fnb_mark_shipped('${f.order}','${f.lines[0]}'));`;
const result=(out,tag)=>out.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(row=>row.tag===tag)?.result;
const a=open('a'),b=open('b');let observedBlock=false;
try{
 a.send(`BEGIN;${auth}${command('A')}SELECT 'A_READY';`);await a.until('A_READY');
 assert.equal(result(a.out,'A').idempotent,false);
 b.send(`BEGIN;${auth}${command('B')}SELECT 'B_READY';`);
 const end=Date.now()+10000;
 while(Date.now()<end){
  observedBlock=sql("SELECT coalesce(bool_or(a.pid=ANY(pg_blocking_pids(b.pid)) AND b.wait_event_type='Lock'),false) FROM pg_stat_activity a CROSS JOIN pg_stat_activity b WHERE a.application_name='fnb384-a' AND b.application_name='fnb384-b';")==='t';
  if(observedBlock)break;assert.ok(!b.out.includes('B_READY'),'second request did not overlap');await delay(40);
 }
 assert.ok(observedBlock,'actual row-lock overlap required');
 a.send("COMMIT;SELECT 'A_DONE';");await a.until('A_DONE');await b.until('B_READY');
 assert.equal(result(b.out,'B').status,'ok');assert.equal(result(b.out,'B').idempotent,true);assert.equal(result(b.out,'B').all_shipped,false);
 b.send("COMMIT;SELECT 'B_DONE';");await b.until('B_DONE');
 assert.equal(sql(`SELECT count(*) FROM public.fnb_order_events WHERE order_id='${f.order}' AND action='line_shipped';`),'1');
 assert.equal(sql(`SELECT on_hand FROM public.fnb_ingredients WHERE id='${f.ingredient}';`),'7');
 assert.equal(sql(`SELECT status FROM public.fnb_orders WHERE id='${f.order}';`),'paid');
 assert.equal(other(),before,'unrelated facts changed');
 console.log('FNB384_TRUE_ROW_LOCK_OVERLAP_FIRST_LINE_ONCE_SECOND_REPLAY_STOCK7_OTHER_FACTS_UNCHANGED_PASS',JSON.stringify({order:f.order,firstLine:f.lines[0],remainingLine:f.lines[1]}));
}finally{await Promise.all([a.close(),b.close()]);}
