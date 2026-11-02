import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.VINPOKER_FNB799_COMMIT_CLONE,'1');
const base=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',base,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT to_regclass('floor_private.fnb799_commit_fixture') IS NULL;"),'t','consumed constructor: retain evidence, never reset or reseed');
assert.equal(sql("SELECT md5(pg_get_functiondef('public.fnb_mark_paid(uuid,text)'::regprocedure))||'|'||md5(pg_get_functiondef('public.fnb_expire_pending_orders()'::regprocedure));"),'fa4cd61ac0c54efdd6c1dd9f66795847|3c1e686f79c1b19e02992a2decd5a42f');
const f={club:randomUUID(),actor:randomUUID(),ingredient:randomUUID(),menu:randomUUID()};
const oldTables=['fnb_orders','fnb_order_events','fnb_ingredients','fnb_stock_movements','fnb_cashier_shifts'];
const protectedFingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 ${oldTables.map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${table} x WHERE club_id<>'${f.club}')`).join(',')},
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x WHERE order_id NOT IN(SELECT id FROM public.fnb_orders WHERE club_id='${f.club}')),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);`);
const before=protectedFingerprint();
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const service="SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{\"role\":\"service_role\"}';SET LOCAL ROLE service_role;";
const created=JSON.parse(sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${f.actor}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${f.club}','${f.actor}','LOCAL799 commit race TEST','TEST','approved');
 INSERT INTO public.fnb_settings(club_id,pending_ttl_secs,guest_bank_ttl_secs) VALUES('${f.club}',900,1800);
 INSERT INTO public.fnb_ingredients(id,club_id,name,stock_unit,on_hand,avg_unit_cost) VALUES('${f.ingredient}','${f.club}','LOCAL799 ingredient','unit',20,1000);
 INSERT INTO public.fnb_menu_items(id,club_id,name,price_vnd,is_active,tracks_inventory) VALUES('${f.menu}','${f.club}','LOCAL799 item',5000,true,true);
 INSERT INTO public.fnb_recipe_items(club_id,menu_item_id,ingredient_id,qty) VALUES('${f.club}','${f.menu}','${f.ingredient}',2);
 CREATE TABLE floor_private.fnb799_commit_fixture(fixture jsonb NOT NULL,protected_before text NOT NULL);
 CREATE TABLE floor_private.fnb799_commit_steps(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,step text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.fnb799_commit_fixture ENABLE ROW LEVEL SECURITY;ALTER TABLE floor_private.fnb799_commit_steps ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.fnb799_commit_fixture,floor_private.fnb799_commit_steps FROM PUBLIC,anon,authenticated,service_role;
 ${auth}
 DO $$DECLARE a jsonb;b jsonb;BEGIN
 a:=public.fnb_create_order('${f.club}','counter',NULL,'LOCAL799 payment wins',NULL,'[{"menu_item_id":"${f.menu}","qty":1}]','LOCAL799-A-${f.club}',NULL,NULL);
 b:=public.fnb_create_order('${f.club}','counter',NULL,'LOCAL799 expiry wins',NULL,'[{"menu_item_id":"${f.menu}","qty":1}]','LOCAL799-B-${f.club}',NULL,NULL);
 ASSERT a->>'status'='ok' AND b->>'status'='ok';
 PERFORM set_config('test799.a',a->>'order_id',true);PERFORM set_config('test799.b',b->>'order_id',true);
 END $$;
 RESET ROLE;
 -- Only NEW fixture timestamps set up expiry eligibility; old facts never rewritten.
 UPDATE public.fnb_orders SET created_at=now()-interval '901 seconds',payment_method='cash' WHERE club_id='${f.club}';
 INSERT INTO floor_private.fnb799_commit_fixture VALUES(jsonb_build_object('club','${f.club}','actor','${f.actor}','ingredient','${f.ingredient}','menu','${f.menu}','a',current_setting('test799.a'),'b',current_setting('test799.b')),'${before}');
 INSERT INTO floor_private.fnb799_commit_steps(step,payload) VALUES('seed','{"orders":2,"stock":20,"synthetic_ttl":true}');
 SELECT fixture FROM floor_private.fnb799_commit_fixture;COMMIT;`));
Object.assign(f,created);
function session(label){
 const name=`fnb799-${label}-${f.club}`;const child=spawn('wsl',base,{stdio:['pipe','pipe','pipe']});let output='',errors='';
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>{output+=s;});child.stderr.on('data',s=>{errors+=s;});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(errors)));});void closed.catch(()=>{});
 const send=q=>child.stdin.write(q+'\n');
 const until=async marker=>{const end=Date.now()+8000;while(!output.includes(marker)){assert.ok(child.exitCode===null,errors);assert.ok(Date.now()<end,`${label} missing ${marker}: ${errors}`);await delay(40);}};
 send(`SET application_name='${name}';`);
 return {name,send,until,line(prefix){return output.split(/\r?\n/).filter(s=>s.startsWith(prefix)).at(-1)?.slice(prefix.length);},async close(){if(child.exitCode===null)child.stdin.end('ROLLBACK;\n\\q\n');await closed;}};
}
const shield=session('shield'),pay=session('pay'),expiry=session('expiry');
const shieldSql=target=>`BEGIN;SET LOCAL statement_timeout='8s';SELECT count(*) FROM(SELECT id FROM public.fnb_orders WHERE status='pending' AND id<>'${target}' ORDER BY id FOR UPDATE)x;`;
const mark=(id,key)=>`SELECT 'PAY|'||public.fnb_mark_paid('${id}','${key}')::text;`;
try{
 // Shield EVERY other pending row, including fixture B, so expiry cannot commit old changes.
 shield.send(`${shieldSql(f.a)}SELECT 'SHIELD_A';`);await shield.until('SHIELD_A');
 pay.send(`BEGIN;SET LOCAL statement_timeout='8s';${auth}${mark(f.a,'LOCAL799-PAY-A')}SELECT 'PAY_A_HELD';`);await pay.until('PAY_A_HELD');
 assert.equal(JSON.parse(pay.line('PAY|')).status,'ok');
 expiry.send(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='500ms';${service}SELECT 'EXPIRE_A|'||public.fnb_expire_pending_orders()::text;COMMIT;SELECT 'EXPIRE_A_COMMITTED';`);await expiry.until('EXPIRE_A_COMMITTED');
 assert.equal(expiry.line('EXPIRE_A|'),'0');
 pay.send("COMMIT;SELECT 'PAY_A_COMMITTED';");await pay.until('PAY_A_COMMITTED');
 sql("INSERT INTO floor_private.fnb799_commit_steps(step,payload) VALUES('payment_wins','{\"expiry_count\":0,\"payment_committed\":true}');");
 shield.send("ROLLBACK;SELECT 'SHIELD_A_RELEASED';");await shield.until('SHIELD_A_RELEASED');
 // Reverse ordering: expiry owns B; real payer must wait, then reject the committed terminal state.
 shield.send(`${shieldSql(f.b)}SELECT 'SHIELD_B';`);await shield.until('SHIELD_B');
 expiry.send(`BEGIN;SET LOCAL statement_timeout='8s';${service}SELECT 'EXPIRE_B|'||public.fnb_expire_pending_orders()::text;SELECT 'EXPIRE_B_HELD';`);await expiry.until('EXPIRE_B_HELD');
 assert.equal(expiry.line('EXPIRE_B|'),'1');
 pay.send(`BEGIN;SET LOCAL statement_timeout='8s';${auth}${mark(f.b,'LOCAL799-PAY-B')}SELECT 'PAY_B_DONE';`);
 const end=Date.now()+5000;let blocked=false;
 while(Date.now()<end){
  blocked=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity p JOIN pg_stat_activity e ON e.application_name='${expiry.name}' WHERE p.application_name='${pay.name}' AND p.wait_event_type='Lock' AND p.wait_event='transactionid' AND e.pid=ANY(pg_blocking_pids(p.pid)));`)==='t';
  if(blocked)break;await delay(40);
 }
 assert.ok(blocked,'canonical payment did not demonstrably wait for expiry');
 expiry.send("COMMIT;SELECT 'EXPIRE_B_COMMITTED';");await expiry.until('EXPIRE_B_COMMITTED');await pay.until('PAY_B_DONE');
 assert.deepEqual(JSON.parse(pay.line('PAY|')),{error:'BAD_STATE',status:'expired'});
 pay.send("COMMIT;SELECT 'PAY_B_COMMITTED_NOOP';");await pay.until('PAY_B_COMMITTED_NOOP');
 shield.send("ROLLBACK;SELECT 'SHIELD_B_RELEASED';");await shield.until('SHIELD_B_RELEASED');
 const state=JSON.parse(sql(`SELECT jsonb_build_object('a',(SELECT status FROM public.fnb_orders WHERE id='${f.a}'),'b',(SELECT status FROM public.fnb_orders WHERE id='${f.b}'),
 'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id='${f.ingredient}'),'movements',(SELECT count(*) FROM public.fnb_stock_movements WHERE club_id='${f.club}'),
 'delta',(SELECT sum(delta) FROM public.fnb_stock_movements WHERE club_id='${f.club}'),
 'paid_events',(SELECT count(*) FROM public.fnb_order_events WHERE club_id='${f.club}' AND action='paid'),
 'expiry_events',(SELECT count(*) FROM public.fnb_order_events WHERE club_id='${f.club}' AND action='expired'));`));
 assert.deepEqual(state,{a:'paid',b:'expired',stock:18,movements:1,delta:-2,paid_events:1,expiry_events:1});
 assert.equal(protectedFingerprint(),before,'old clone facts changed');
 sql(`INSERT INTO floor_private.fnb799_commit_steps(step,payload) VALUES('expiry_wins','{"payer_wait":"Lock:transactionid","payer_result":"BAD_STATE","expiry_committed":true}'),('verified','${JSON.stringify(state)}');`);
}finally{
 const done=await Promise.allSettled([shield.close(),pay.close(),expiry.close()]);assert.ok(done.every(x=>x.status==='fulfilled'),'session cleanup failed');
 assert.equal(protectedFingerprint(),before,'old facts changed after cleanup');
}
console.log('FNB799_NATIVE_BOTH_COMMIT_ORDERINGS_OWNER_PAYMENT_EXPIRY_REAL_WAIT_ONE_SALE_NO_DOUBLE_STOCK_OLD_FACTS_PRESERVED_PASS',JSON.stringify(f));
