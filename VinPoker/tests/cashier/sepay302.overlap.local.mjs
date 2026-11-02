import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.VINPOKER_SEPAY_OVERLAP302,'1');
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql'];
const args=[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.cashier_sepay_intent_v1(text,text,uuid,uuid,text,uuid,jsonb)'::regprocedure;"),'b4dc451a84c1bc1e52e7bd19cee12a0c');
const f={club:'e3020000-0000-4000-8000-000000000001',actor:'e3020000-0000-4000-8000-000000000002',
 other:'e3020000-0000-4000-8000-000000000003',banks:['e3020000-0000-4000-8000-000000000010','e3020000-0000-4000-8000-000000000011'],
 keys:['e3020000-0000-4000-8000-000000000020','e3020000-0000-4000-8000-000000000021','e3020000-0000-4000-8000-000000000022']};
if(process.env.VINPOKER_SEPAY_RECEIPT_READ302==='1'){
 const {parseSePayReceipt}=await import('../../src/lib/sepaySettlementIntent.ts');
 for(const [actor,bank,key,reason] of [[f.actor,f.banks[0],f.keys[0],'TEST same key'],
  [f.actor,f.banks[1],f.keys[1],'TEST first actor'],[f.other,f.banks[1],f.keys[2],'TEST second actor']]){
  const value=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';
   SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   SELECT public.cashier_sepay_intent_v1('receipt','ignore','${bank}',NULL,'${reason}','${key}',
   '{"bank_amount":1000,"total_pay":null}'::jsonb);ROLLBACK;`));
  assert.deepEqual(parseSePayReceipt(value,{actorId:actor,clubId:f.club,bankId:bank,requestId:key,
   registrationId:null,operation:'ignore',reason,snapshot:{bank_amount:1000,total_pay:null}}),{status:'ignored'});
 }
 console.log('SEPAY302_THREE_ACTUAL_NATIVE_RECEIPTS_PRODUCT_PARSER_PASS_NO_NEW_COMMIT');
 process.exit(0);
}
assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE id='${f.club}';`),'0','No reseed/replay: inspect existing fixture if this run was interrupted');
sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${f.actor}'),('${f.other}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${f.club}','${f.actor}','SePay302 isolated overlap TEST','TEST','approved');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${f.other}');
 INSERT INTO public.bank_transactions(id,provider_txn_id,account_number,club_id,amount,transfer_type)
 VALUES('${f.banks[0]}','LOCAL-SEPAY302-0','NON-BANK-TEST302','${f.club}',1000,'in'),
 ('${f.banks[1]}','LOCAL-SEPAY302-1','NON-BANK-TEST302','${f.club}',1000,'in');
 CREATE TABLE floor_private.sepay302_fixture(fixture jsonb NOT NULL);
 REVOKE ALL ON floor_private.sepay302_fixture FROM PUBLIC,anon,authenticated,service_role;
 ALTER TABLE floor_private.sepay302_fixture ENABLE ROW LEVEL SECURITY;
 INSERT INTO floor_private.sepay302_fixture VALUES('${JSON.stringify(f)}'::jsonb);COMMIT;`);

function session(name){
 const proc=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});
 let output='',errors='';let closed=false;
 proc.stdout.setEncoding('utf8');proc.stderr.setEncoding('utf8');
 proc.stdout.on('data',x=>{output+=x;});proc.stderr.on('data',x=>{errors+=x;});proc.on('close',()=>{closed=true;});
 const send=q=>proc.stdin.write(q+'\n');
 const until=async marker=>{const end=Date.now()+12000;while(!output.includes(marker)){
  if(closed)throw Error(`${name} closed: ${errors}`);if(Date.now()>end)throw Error(`${name} missing marker ${marker}: ${errors}`);await delay(40);
 }};
 send(`SET application_name='sepay302-${name}';`);
 return {send,until,get output(){return output;},close:()=>proc.stdin.end('ROLLBACK;\n\\q\n')};
}
const auth=actor=>`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const call=(bank,key,reason)=>`SELECT public.cashier_sepay_intent_v1('commit','ignore','${bank}',NULL,'${reason}','${key}','{"bank_amount":1000,"total_pay":null}'::jsonb);`;
async function proveWait(name,expected){
 const end=Date.now()+10000;
 while(Date.now()<end){
  const event=sql(`SELECT wait_event_type||':'||wait_event FROM pg_stat_activity WHERE application_name='sepay302-${name}' AND state='active';`);
  if(event===expected)return event;await delay(60);
 }
 throw Error(`No observed ${expected} for ${name}`);
}
const receipt=output=>JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{'))??'null');
const a=session('a'),b=session('b');
const waits=[];
try{
 a.send(`BEGIN;${auth(f.actor)}${call(f.banks[0],f.keys[0],'TEST same key')}SELECT 'A_READY';`);await a.until('A_READY');
 b.send(`BEGIN;${auth(f.actor)}${call(f.banks[0],f.keys[0],'TEST same key')}SELECT 'B_DONE';`);
 waits.push(await proveWait('b','Lock:advisory'));a.send("COMMIT;SELECT 'A_COMMITTED';");await a.until('A_COMMITTED');await b.until('B_DONE');
 const first=receipt(a.output),second=receipt(b.output);
 assert.equal(first.receipt.outcome,'dismissed');assert.equal(second.replayed,true);assert.deepEqual(first.receipt,second.receipt);
 b.send("COMMIT;SELECT 'B_COMMITTED';");await b.until('B_COMMITTED');
 // Second case: different actor/key must wait for the same bank row, not duplicate dismissal.
 a.send(`BEGIN;${auth(f.actor)}${call(f.banks[1],f.keys[1],'TEST first actor')}SELECT 'A_SECOND_READY';`);await a.until('A_SECOND_READY');
 b.send(`BEGIN;${auth(f.other)}${call(f.banks[1],f.keys[2],'TEST second actor')}SELECT 'B_SECOND_DONE';`);
 waits.push(await proveWait('b','Lock:transactionid'));a.send("COMMIT;SELECT 'A_SECOND_COMMITTED';");await a.until('A_SECOND_COMMITTED');await b.until('B_SECOND_DONE');
 const last=JSON.parse(b.output.split(/\r?\n/).filter(line=>line.startsWith('{')).at(-1));assert.equal(last.receipt.already_ignored,true);
 b.send("COMMIT;SELECT 'B_SECOND_COMMITTED';");await b.until('B_SECOND_COMMITTED');
 const state=JSON.parse(sql(`SELECT jsonb_build_object('banks',(SELECT count(*) FROM public.bank_transactions WHERE club_id='${f.club}' AND status='ignored'),
  'settlements',(SELECT count(*) FROM public.payment_settlements WHERE club_id='${f.club}' AND outcome='dismissed'),
  'receipts',(SELECT count(*) FROM public.ops_cashier_mutation_idempotency WHERE idempotency_key IN(
  'sepay:v1:${f.actor}:${f.keys[0]}','sepay:v1:${f.actor}:${f.keys[1]}','sepay:v1:${f.other}:${f.keys[2]}')),
  'moneyMovements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE club_id='${f.club}'));`));
 assert.deepEqual(state,{banks:2,settlements:2,receipts:3,moneyMovements:0});
 console.log('SEPAY302_ACTUAL_IGNORE_OVERLAP_PASS_NOT_PRICED_CONFIRM',JSON.stringify({fixture:f,waits,state}));
}finally{a.close();b.close();}
