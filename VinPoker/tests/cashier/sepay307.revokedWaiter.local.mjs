import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
assert.equal(process.env.VINPOKER_SEPAY_REVOKE307,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)'::regprocedure;"),'b4dc451a84c1bc1e52e7bd19cee12a0c');
const f=JSON.parse(sql('SELECT fixture FROM floor_private.sepay305_fixture;'));
assert.equal(f.club,'7f3c6f90-3667-4c8c-9a00-6f00da680d84');assert.equal(f.actor,'40b8f243-bf3b-4aaa-962b-db788380207c');
const roleState=()=>JSON.parse(sql(`SELECT jsonb_build_object('owner',c.owner_id,'cashiers',
 (SELECT jsonb_agg(to_jsonb(cc) ORDER BY user_id) FROM public.club_cashiers cc WHERE cc.club_id=c.id)) FROM public.clubs c WHERE id='${f.club}';`));
const prior=roleState();assert.equal(prior.owner,f.actor);assert.equal(prior.cashiers.length,2);
assert.ok(prior.cashiers.some(x=>x.user_id===f.actor));assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE owner_id='${f.other}';`),'0');
const cashFingerprint=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'banks',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bank_transactions x),
 'settlements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.payment_settlements x),
 'receipts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY idempotency_key) FROM public.ops_cashier_mutation_idempotency x),
 'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
const before=cashFingerprint();
sql(`BEGIN;CREATE TABLE floor_private.sepay307_role_snapshot(snapshot jsonb NOT NULL,completed boolean NOT NULL DEFAULT false);
 REVOKE ALL ON floor_private.sepay307_role_snapshot FROM PUBLIC,anon,authenticated,service_role;
 ALTER TABLE floor_private.sepay307_role_snapshot ENABLE ROW LEVEL SECURITY;
 INSERT INTO floor_private.sepay307_role_snapshot(snapshot) VALUES('${JSON.stringify(prior).replaceAll("'","''")}'::jsonb);COMMIT;`);
function session(name){
 const p=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',closed=false;
 p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',()=>closed=true);
 const send=q=>p.stdin.write(q+'\n');send(`SET application_name='sepay307-${name}';SET statement_timeout='10s';SET idle_in_transaction_session_timeout='15s';`);
 return {send,get out(){return out;},async until(marker){const end=Date.now()+12000;while(!out.includes(marker)){
  if(closed)throw Error(err);if(Date.now()>end)throw Error('missing '+marker+':'+err);await delay(40);
 }},close(){p.stdin.end('ROLLBACK;\n\\q\n');}};
}
const a=session('holder'),b=session('waiter');
try{
 a.send(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('sepay:v1:${f.actor}:${f.keys[0]}',0));SELECT 'HELD307';`);await a.until('HELD307');
 b.send(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';
  SET LOCAL request.jwt.claims='{"sub":"${f.actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
  SELECT public.cashier_sepay_intent_v1('receipt','confirm','${f.banks[0]}','${f.registrations[0]}',NULL,'${f.keys[0]}',
  '{"bank_amount":100000,"total_pay":100000}'::jsonb);SELECT 'DONE307';`);
 let observed=false;for(let n=0;n<100;n++){
  if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='sepay307-waiter' AND wait_event_type='Lock' AND wait_event='advisory');")==='t'){observed=true;break;}await delay(40);
 }assert.equal(observed,true,'waiter actually overlaps before revocation');assert.ok(!b.out.includes('DONE307'));
 sql(`BEGIN;DELETE FROM public.club_cashiers WHERE club_id='${f.club}' AND user_id='${f.actor}';
  UPDATE public.clubs SET owner_id='${f.other}' WHERE id='${f.club}';COMMIT;`);
 assert.equal(sql(`SELECT public.is_club_cashier('${f.actor}','${f.club}');`),'f');
 a.send("COMMIT;SELECT 'RELEASED307';");await a.until('RELEASED307');await b.until('DONE307');
 const result=JSON.parse(b.out.split(/\r?\n/).find(x=>x.startsWith('{')));assert.deepEqual(result,{ok:false,error:'actor_not_allowed'});
 b.send("ROLLBACK;SELECT 'ROLLED307';");await b.until('ROLLED307');
 assert.equal(cashFingerprint(),before,'denied waiter cannot change money/receipt');
 console.log('SEPAY307_REAL_ADVISORY_WAIT_REVOKED_ACTOR_DENIED_OLD_RECEIPT_PASS');
}finally{
 a.close();b.close();
 const current=roleState();assert.ok([f.actor,f.other].includes(current.owner),'do not overwrite unknown owner change');
 const ownerCashier=prior.cashiers.find(x=>x.user_id===f.actor);
 sql(`BEGIN;UPDATE public.clubs SET owner_id='${f.actor}' WHERE id='${f.club}';
  INSERT INTO public.club_cashiers SELECT * FROM jsonb_populate_record(NULL::public.club_cashiers,'${JSON.stringify(ownerCashier).replaceAll("'","''")}'::jsonb)
  WHERE NOT EXISTS(SELECT 1 FROM public.club_cashiers WHERE club_id='${f.club}' AND user_id='${f.actor}');
  UPDATE floor_private.sepay307_role_snapshot SET completed=true;COMMIT;`);
 assert.deepEqual(roleState(),prior);assert.equal(cashFingerprint(),before);
 console.log('SEPAY307_EXACT_TEST_ROLES_RESTORED_ALL_MONEY_RECEIPTS_UNCHANGED_PASS');
}
