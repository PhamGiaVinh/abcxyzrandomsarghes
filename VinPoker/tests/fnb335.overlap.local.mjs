import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fnbGuestCreateOutcome} from '../src/lib/fnbMutationOutcome.ts';
assert.equal(process.env.VINPOKER_FNB335,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_create_order(text,smallint,text,text,jsonb,text,text)'::regprocedure;"),'7d88cb039763da1b2135e79d80368529');
if(process.env.VINPOKER_FNB335_READ==='1'){
 const rows=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_agg(r.result) FROM floor_private.fnb_guest_request_receipts_v1 r
 JOIN public.fnb_orders o ON o.id=r.order_id WHERE o.club_id=(SELECT (fixture->>'club')::uuid FROM floor_private.fnb335_fixture)
 AND r.payload->>'customer_name'='TEST';ROLLBACK;`));
 assert.equal(rows.length,6);
 assert.ok(rows.every(r=>fnbGuestCreateOutcome(r,'cash').kind==='confirmed'));
 console.log('FNB337_SIX_ACTUAL_STORED_RECEIPTS_PRODUCT_PARSER_PASS_READ_ONLY');process.exit(0);
}
assert.equal(sql("SELECT to_regclass('floor_private.fnb335_fixture') IS NULL;"),'t','retained fixture must never be reseeded');
sql(`BEGIN;DO $$ DECLARE owner_id uuid:=gen_random_uuid();club uuid:=gen_random_uuid();item uuid:=gen_random_uuid();
 t30 uuid;t31 uuid;token_a text:='LOCAL335-'||gen_random_uuid();token_b text:='LOCAL335-'||gen_random_uuid();BEGIN
 INSERT INTO auth.users(id) VALUES(owner_id);
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Guest335 concurrency TEST','TEST','approved');
 INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES(club,false);
 INSERT INTO public.fnb_settings(club_id,guest_order_enabled) VALUES(club,true) ON CONFLICT(club_id) DO UPDATE SET guest_order_enabled=true;
 SELECT id INTO t30 FROM public.game_tables WHERE club_id=club AND table_number=30;
 SELECT id INTO t31 FROM public.game_tables WHERE club_id=club AND table_number=31;
 INSERT INTO public.fnb_table_qr_tokens(club_id,table_ref,token,is_active) VALUES(club,t30,token_a,true),(club,t31,token_b,true);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES(item,club,'Guest335 TEST coffee',10000,true,false);
 CREATE TABLE floor_private.fnb335_fixture(fixture jsonb NOT NULL);
 ALTER TABLE floor_private.fnb335_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.fnb335_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.fnb335_fixture VALUES(jsonb_build_object('club',club,'item',item,'tokens',jsonb_build_array(token_a,token_b),
 'keys',jsonb_build_array(gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),'completed',false));END $$;COMMIT;`);
const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb335_fixture;'));
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x WHERE club_id<>'${f.club}'),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x WHERE club_id<>'${f.club}'),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
const before=fingerprint();
const call=(token,key,qty=1)=>`SELECT public.fnb_guest_create_order('${token}',3::smallint,'TEST',NULL,'[{"menu_item_id":"${f.item}","qty":${qty}}]','cash','${key}');`;
function session(name){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',closed=false;
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',()=>closed=true);
 const send=q=>child.stdin.write(q+'\n');send(`SET application_name='fnb335-${name}';SET statement_timeout='10s';SET idle_in_transaction_session_timeout='20s';`);
 return {send,get out(){return out;},async until(marker){const end=Date.now()+12000;while(!out.includes(marker)){
  if(closed)throw Error(err);if(Date.now()>end)throw Error('missing '+marker);await delay(40);
 }},async close(){child.stdin.end('ROLLBACK;\n\\q\n');if(!closed)await new Promise(resolve=>child.once('close',resolve));}};
}
const anon="SET LOCAL request.jwt.claims='{\"role\":\"anon\"}';SET LOCAL ROLE anon;";
const last=out=>JSON.parse(out.split(/\r?\n/).filter(x=>x.startsWith('{')).at(-1));
async function overlap(){const end=Date.now()+10000;while(Date.now()<end){
 const value=sql("SELECT b.wait_event_type||':'||b.wait_event FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='fnb335-a' WHERE b.application_name='fnb335-b' AND b.state='active' AND a.pid=ANY(pg_blocking_pids(b.pid));");
 if(value.startsWith('Lock:'))return value;await delay(60);
}throw Error('no real335 blocking overlap');}
const a=session('a'),b=session('b'),waits=[];
try{
 for(const [n,qty] of [[1,1],[2,2]]){
  a.send(`BEGIN;${anon}${call(f.tokens[0],f.keys[0])}SELECT 'A${n}';`);await a.until(`A${n}`);
  b.send(`BEGIN;${anon}${call(f.tokens[0],f.keys[0],qty)}SELECT 'B${n}';`);waits.push(await overlap());
  a.send(`COMMIT;SELECT 'AC${n}';`);await a.until(`AC${n}`);await b.until(`B${n}`);
  if(n===1){assert.equal(last(a.out).order_id,last(b.out).order_id);assert.equal(last(b.out).idempotent,true);}
  else assert.equal(last(b.out).error,'REQUEST_ID_CONFLICT');
  b.send(`COMMIT;SELECT 'BC${n}';`);await b.until(`BC${n}`);
 }
 sql(`BEGIN;SET LOCAL ROLE anon;${[0,1,2,3].map(n=>call(f.tokens[1],`seed335-${n}`)).join('')}COMMIT;`);
 a.send(`BEGIN;${anon}${call(f.tokens[1],f.keys[1])}SELECT 'A3';`);await a.until('A3');
 b.send(`BEGIN;${anon}${call(f.tokens[1],f.keys[2])}SELECT 'B3';`);waits.push(await overlap());
 a.send("COMMIT;SELECT 'AC3';");await a.until('AC3');await b.until('B3');
 assert.equal(last(a.out).status,'ok');assert.equal(last(b.out).error,'TABLE_PENDING_LIMIT');
 b.send("COMMIT;SELECT 'BC3';");await b.until('BC3');
 const counts=JSON.parse(sql(`SELECT jsonb_build_object('orders',(SELECT count(*) FROM public.fnb_orders WHERE club_id='${f.club}'),
 'receipts',(SELECT count(*) FROM floor_private.fnb_guest_request_receipts_v1 r JOIN public.fnb_orders o ON o.id=r.order_id WHERE o.club_id='${f.club}'),
 'amount',(SELECT sum(subtotal_vnd) FROM public.fnb_orders WHERE club_id='${f.club}'));`));
 assert.deepEqual(counts,{orders:6,receipts:6,amount:60000});assert.equal(fingerprint(),before);
 sql("UPDATE floor_private.fnb335_fixture SET fixture=jsonb_set(fixture,'{completed}','true');");
 console.log('FNB335_TRUE_OVERLAP_SAME_KEY_CONFLICT_AND_CAP_PASS',JSON.stringify({club:f.club,waits,counts,otherBusinessUnchanged:true}));
}finally{await Promise.all([a.close(),b.close()]);}
