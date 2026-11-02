import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
assert.equal(process.env.VINPOKER_FNB348,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_abandon_request_v1(text,smallint,text,text,jsonb,text,text)'::regprocedure;"),'1c1ade1d97afba249f1bdcc88c252147');
assert.equal(sql("SELECT to_regclass('floor_private.fnb348_fixture') IS NULL;"),'t','never reseed retained348');
const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb335_fixture;'));assert.equal(f.completed,true);
const keys=[randomUUID(),randomUUID()];const keyList=keys.map(k=>`'${k}'`).join(',');
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x WHERE client_request_id IS NULL OR client_request_id NOT IN(${keyList})),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x WHERE order_id NOT IN(SELECT id FROM public.fnb_orders WHERE client_request_id IN(${keyList}))),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY token_id,request_id) FROM floor_private.fnb_guest_request_receipts_v1 x WHERE request_id NOT IN(${keyList})),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x))::text);`);
const before=fingerprint();
sql(`BEGIN;CREATE TABLE floor_private.fnb348_fixture(fixture jsonb NOT NULL);ALTER TABLE floor_private.fnb348_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.fnb348_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.fnb348_fixture VALUES('${JSON.stringify({club:f.club,keys,completed:false})}'::jsonb);COMMIT;`);
function session(name){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',closed=false;
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',()=>closed=true);
 const send=q=>child.stdin.write(q+'\n');send(`SET application_name='fnb348-${name}';SET statement_timeout='10s';SET idle_in_transaction_session_timeout='20s';`);
 return {send,get out(){return out;},async until(marker){const end=Date.now()+12000;while(!out.includes(marker)){
  if(closed)throw Error(err);if(Date.now()>end)throw Error('missing '+marker);await delay(40);
 }},async close(){child.stdin.end('ROLLBACK;\n\\q\n');if(!closed)await new Promise(resolve=>child.once('close',resolve));}};
}
const anon="SET LOCAL request.jwt.claims='{\"role\":\"anon\"}';SET LOCAL ROLE anon;";
const call=(rpc,key)=>`SELECT public.${rpc}('${f.tokens[0]}',3::smallint,'TEST348',NULL,'[{"menu_item_id":"${f.item}","qty":1}]','cash','${key}');`;
const last=out=>JSON.parse(out.split(/\r?\n/).filter(x=>x.startsWith('{')).at(-1));
async function blocking(){const end=Date.now()+10000;while(Date.now()<end){
 const wait=sql("SELECT b.wait_event_type||':'||b.wait_event FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='fnb348-a' WHERE b.application_name='fnb348-b' AND b.state='active' AND a.pid=ANY(pg_blocking_pids(b.pid));");
 if(wait.startsWith('Lock:'))return wait;await delay(60);
}throw Error('no real348 overlap');}
const a=session('a'),b=session('b'),waits=[],results=[];
try{
 for(let n=0;n<2;n++){
  a.send(`BEGIN;${anon}${call(n===0?'fnb_guest_abandon_request_v1':'fnb_guest_create_order',keys[n])}SELECT 'A${n}';`);await a.until(`A${n}`);
  b.send(`BEGIN;${anon}${call(n===0?'fnb_guest_create_order':'fnb_guest_abandon_request_v1',keys[n])}SELECT 'B${n}';`);waits.push(await blocking());
  a.send(`COMMIT;SELECT 'AC${n}';`);await a.until(`AC${n}`);await b.until(`B${n}`);
  const first=last(a.out),second=last(b.out);
  if(n===0){assert.equal(first.receipt.error,'REQUEST_ABANDONED');assert.equal(second.error,'REQUEST_ABANDONED');}
  else{assert.equal(first.status,'ok');assert.equal(second.receipt.order_id,first.order_id);assert.equal(second.receipt.status,'ok');}
  results.push({key:keys[n],order:first.order_id??null});b.send(`COMMIT;SELECT 'BC${n}';`);await b.until(`BC${n}`);
 }
 assert.equal(sql(`SELECT count(*) FROM public.fnb_orders WHERE client_request_id='${keys[0]}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.fnb_orders WHERE client_request_id='${keys[1]}' AND status='pending' AND subtotal_vnd=10000;`),'1');
 assert.equal(sql(`SELECT count(*) FROM floor_private.fnb_guest_request_receipts_v1 WHERE request_id IN(${keyList});`),'2');
 assert.equal(fingerprint(),before);
 sql(`UPDATE floor_private.fnb348_fixture SET fixture=fixture||'${JSON.stringify({completed:true,waits,results})}'::jsonb;`);
 console.log('FNB348_TRUE_OVERLAP_ABANDON_FIRST_CREATE_FIRST_PASS',JSON.stringify({waits,results,otherStateUnchanged:true}));
}finally{await a.close();await b.close();}
