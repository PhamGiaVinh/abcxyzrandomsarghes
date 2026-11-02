import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {parseSePayReceipt} from '../../src/lib/sepaySettlementIntent.ts';

assert.equal(process.env.VINPOKER_SEPAY_CONFIRM305,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)'::regprocedure;"),'b4dc451a84c1bc1e52e7bd19cee12a0c');
if(process.env.VINPOKER_SEPAY_CONFIRM305_READ==='1'){
 const f=JSON.parse(sql('SELECT fixture FROM floor_private.sepay305_fixture;'));
 for(const [index,actor,key,rejected] of [[0,f.actor,f.keys[0],false],[1,f.actor,f.keys[1],false],[1,f.other,f.keys[2],true]]){
  const r=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   SELECT public.cashier_sepay_intent_v1('receipt','confirm','${f.banks[index]}','${f.registrations[index]}',NULL,'${key}',
   '{"bank_amount":100000,"total_pay":100000}'::jsonb);ROLLBACK;`));
  assert.deepEqual(parseSePayReceipt(r,{actorId:actor,clubId:f.club,bankId:f.banks[index],registrationId:f.registrations[index],requestId:key,
   operation:'confirm',reason:null,snapshot:{bank_amount:100000,total_pay:100000}}),rejected?{status:'rejected',error:'already_settled'}:{status:'seated',surplus:0});
 }
 console.log('SEPAY305_THREE_ACTUAL_PRICED_RECEIPTS_REPLAY_PASS_NO_NEW_PAYMENT');process.exit(0);
}
assert.equal(sql("SELECT to_regclass('floor_private.sepay305_fixture') IS NULL;"),'t','existing fixture must be inspected, never reseeded');
const raw=readFileSync('tests/cashier/cashPaymentIdentity.pg17.sql','utf8');
const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';assert.equal(raw.split(marker).length,2);
const prefix=raw.slice(0,raw.indexOf(marker));
sql(prefix+`
 DECLARE physical uuid;other_actor uuid:=gen_random_uuid();other_player uuid:=gen_random_uuid();
  second_registration uuid;bank_a uuid:=gen_random_uuid();bank_b uuid:=gen_random_uuid();opened jsonb;
 BEGIN
  PERFORM set_config('role','none',true);
  INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES(club,false);
  INSERT INTO auth.users(id) VALUES(other_actor),(other_player);
  INSERT INTO public.club_cashiers(club_id,user_id) VALUES(club,other_actor);
  INSERT INTO public.profiles(user_id,display_name) VALUES(player_id,'SePay305 TEST player 1'),(other_player,'SePay305 TEST player 2');
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('role','service_role',true);
  opened:=public.cashier_create_app_registration_v1(tour,other_player);
  PERFORM pg_temp.assert_cash(opened->>'ok'='true','second canonical priced registration');
  second_registration:=(opened->>'registration_id')::uuid;
  PERFORM set_config('role','none',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  SELECT id INTO physical FROM public.game_tables WHERE club_id=club AND table_number=30;
  PERFORM pg_temp.assert_cash(physical IS NOT NULL,'canonical physical inventory');
  PERFORM set_config('role','authenticated',true);
  opened:=public.floor_open_tournament_table_v3(tour,physical,'manual',gen_random_uuid());
  PERFORM pg_temp.assert_cash(opened->>'ok'='true','canonical session opens');
  PERFORM set_config('role','none',true);
  INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,transfer_type,content)
   VALUES(bank_a,'LOCAL-SEPAY305-'||bank_a,'NON-BANK-TEST305',club,100000,'in','SePay305 TEST concurrency only'),
   (bank_b,'LOCAL-SEPAY305-'||bank_b,'NON-BANK-TEST305',club,100000,'in','SePay305 TEST concurrency only');
  CREATE TABLE floor_private.sepay305_fixture(fixture jsonb NOT NULL);
  REVOKE ALL ON floor_private.sepay305_fixture FROM PUBLIC,anon,authenticated,service_role;
  ALTER TABLE floor_private.sepay305_fixture ENABLE ROW LEVEL SECURITY;
  INSERT INTO floor_private.sepay305_fixture VALUES(jsonb_build_object('actor',owner_id,'other',other_actor,'club',club,'tour',tour,
   'players',jsonb_build_array(player_id,other_player),'registrations',jsonb_build_array(registration,second_registration),
   'banks',jsonb_build_array(bank_a,bank_b),'keys',jsonb_build_array(gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),'physical',physical));
 END;
 END $$;COMMIT;`);
const f=JSON.parse(sql('SELECT fixture FROM floor_private.sepay305_fixture;'));
const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE club_id<>'${f.club}'),
 'settlements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payment_settlements x WHERE club_id IS DISTINCT FROM '${f.club}'::uuid),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id<>'${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id<>'${f.tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
const before=fingerprint();
function session(name){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',closed=false;
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('close',()=>closed=true);
 const send=q=>child.stdin.write(q+'\n');send(`SET application_name='sepay305-${name}';SET statement_timeout='10s';SET idle_in_transaction_session_timeout='15s';`);
 return {send,get out(){return out;},async until(text){const end=Date.now()+12000;while(!out.includes(text)){
  if(closed)throw Error(err);if(Date.now()>end)throw Error('missing '+text+':'+err);await delay(40);
 }},close(){child.stdin.end('ROLLBACK;\n\\q\n');}};
}
const auth=actor=>`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const command=(index,key)=>`SELECT public.cashier_sepay_intent_v1('commit','confirm','${f.banks[index]}','${f.registrations[index]}',NULL,'${key}','{"bank_amount":100000,"total_pay":100000}'::jsonb);`;
const intent=(index,actor,key)=>({actorId:actor,clubId:f.club,bankId:f.banks[index],registrationId:f.registrations[index],requestId:key,operation:'confirm',reason:null,snapshot:{bank_amount:100000,total_pay:100000}});
const last=out=>JSON.parse(out.split(/\r?\n/).filter(x=>x.startsWith('{')).at(-1));
async function waitLock(expected){const end=Date.now()+10000;while(Date.now()<end){
 const actual=sql("SELECT wait_event_type||':'||wait_event FROM pg_stat_activity WHERE application_name='sepay305-b' AND state='active';");
 if(actual===expected)return actual;await delay(60);
 }throw Error('no overlap '+expected);}
const a=session('a'),b=session('b'),waits=[];
try{
 a.send(`BEGIN;${auth(f.actor)}${command(0,f.keys[0])}SELECT 'A1_READY';`);await a.until('A1_READY');
 b.send(`BEGIN;${auth(f.actor)}${command(0,f.keys[0])}SELECT 'B1_READY';`);waits.push(await waitLock('Lock:advisory'));
 a.send("COMMIT;SELECT 'A1_DONE';");await a.until('A1_DONE');await b.until('B1_READY');
 assert.deepEqual(last(a.out).receipt,last(b.out).receipt);assert.equal(last(b.out).replayed,true);
 assert.deepEqual(parseSePayReceipt(last(a.out),intent(0,f.actor,f.keys[0])),{status:'seated',surplus:0});
 b.send("COMMIT;SELECT 'B1_DONE';");await b.until('B1_DONE');
 a.send(`BEGIN;${auth(f.actor)}${command(1,f.keys[1])}SELECT 'A2_READY';`);await a.until('A2_READY');
 b.send(`BEGIN;${auth(f.other)}${command(1,f.keys[2])}SELECT 'B2_READY';`);waits.push(await waitLock('Lock:transactionid'));
 a.send("COMMIT;SELECT 'A2_DONE';");await a.until('A2_DONE');await b.until('B2_READY');
 assert.deepEqual(parseSePayReceipt(last(a.out),intent(1,f.actor,f.keys[1])),{status:'seated',surplus:0});
 assert.deepEqual(parseSePayReceipt(last(b.out),intent(1,f.other,f.keys[2])),{status:'rejected',error:'already_settled'});
 b.send("COMMIT;SELECT 'B2_DONE';");await b.until('B2_DONE');
 const state=JSON.parse(sql(`SELECT jsonb_build_object('movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}'),
  'received',(SELECT sum(amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}'),
  'applied',(SELECT sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${f.tour}'),
  'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}'),
  'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active),
  'seatReceipts',(SELECT count(*) FROM public.seat_draw_receipts WHERE tournament_id='${f.tour}' AND status='issued'),
  'settlements',(SELECT count(*) FROM public.payment_settlements WHERE club_id='${f.club}' AND outcome='manual_confirmed'));`));
 assert.deepEqual(state,{movements:2,received:200000,applied:200000,entries:2,seats:2,seatReceipts:2,settlements:2});
 assert.equal(fingerprint(),before,'other journeys unchanged');
 console.log('SEPAY305_PRICED_CONFIRM_ACTUAL_OVERLAP_PRODUCT_PARSER_PASS',JSON.stringify({fixture:f,waits,state}));
}finally{a.close();b.close();}
