import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_cash112_overlap');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash112_overlap','psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=query=>execFileSync(binary,[...prefix,...flags],{input:query,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),'vinpoker_ops_cash112_overlap|127.0.0.1|55441|17');
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const table='cash112_overlap_'+randomUUID().replaceAll('-','');
sql(`CREATE TABLE public.${table}(scenario text PRIMARY KEY,intent jsonb NOT NULL);REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated,service_role;`);
const raw=readFileSync('tests/cashier/cashPaymentIdentity.pg17.sql','utf8');
const trigger=/CREATE FUNCTION pg_temp.fail_cash_receipt[\s\S]*?FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_cash_receipt\(\);/;
assert.ok(trigger.test(raw));
const base=raw.replace(trigger,'');
const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';assert.equal(base.split(marker).length,2);
const argument=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const parse=out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{')));
function tx(name,query,hold=false){
 const child=spawn(binary,[...prefix,...flags]);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(`${command};\n`);};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='15s';${query}\n`);
 if(!hold)end('COMMIT');return {result,end};
}
async function barrier(name,condition){for(let i=0;i<100;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(done=>setTimeout(done,25));}assert.fail('actual overlap barrier absent: '+name);}
for(const scenario of ['record-cancel','cancel-record','legacy-cancel','cancel-legacy','record-legacy']){
 sql(base.replace(marker,` PERFORM set_config('role','none',true);INSERT INTO public.${table}(scenario,intent) VALUES('${scenario}',jsonb_build_object('actor_id',owner_id,'club_id',club,'tournament_id',tour,'registration_id',registration,'amount',10000,'request_id',gen_random_uuid()));RETURN;\n`+marker).replace(/ROLLBACK;\s*$/,'COMMIT;'));
 const intent=JSON.parse(sql(`SELECT intent FROM public.${table} WHERE scenario='${scenario}';`));
 const auth=`SET LOCAL request.jwt.claim.sub='${intent.actor_id}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${intent.actor_id}"}';SET LOCAL ROLE authenticated;`;
 const exact=action=>`SELECT public.resolve_cashier_cash_buyin_intent_v1(${argument(intent)},'${action}');`;
 const legacy=`SELECT public.cashier_record_cash_buyin_v1('${intent.registration_id}',10000,'${intent.request_id}');`;
 const invoke=command=>parse(sql(`BEGIN;${auth}${command}COMMIT;`));
 const [first,second]=scenario.split('-'),call=action=>action==='legacy'?legacy:exact(action);
 const receiptCount=()=>sql(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${intent.actor_id}' AND operation_type='cashier_cash_buyin_v2' AND request_id='${intent.request_id}';`);
 const money=()=>JSON.parse(sql(`SELECT jsonb_build_object('count',count(*),'amount',coalesce(sum(amount),0)) FROM public.cashier_buyin_movements WHERE registration_id='${intent.registration_id}';`));
 let holder,waiter;
 try{
  const suffix=randomUUID().slice(0,8),holderName='cash_holder_'+suffix,waiterName='cash_waiter_'+suffix;
  holder=tx(holderName,auth+call(first),true);
  await barrier(holderName,"wait_event='ClientRead' AND xact_start IS NOT NULL");
  assert.deepEqual(money(),{count:0,amount:0});assert.equal(receiptCount(),'0','uncommitted effects remain invisible');
  waiter=tx(waiterName,auth+call(second));
  if(second==='legacy')await barrier(waiterName,"wait_event_type='Lock'");
  else {const busy=await waiter.result;assert.equal(busy.code,0,busy.error);assert.equal(parse(busy.out).error,'cash_intent_busy');}
  holder.end('COMMIT');const h=await holder.result,w=await waiter.result;assert.equal(h.code,0,h.error);assert.equal(w.code,0,w.error);
  const resolved=invoke(call(second));
  if(first==='cancel'){
   assert.deepEqual(money(),{count:0,amount:0});
   assert.equal(second==='legacy'?resolved.error:resolved.status,second==='legacy'?'cash_intent_cancelled':'cancelled');
   assert.equal(invoke(exact('read')).status,'cancelled');
  }else{
   assert.deepEqual(money(),{count:1,amount:10000});
   assert.equal(second==='legacy'?resolved.ok:resolved.status,second==='legacy'?true:'recorded');
   assert.equal(invoke(exact('read')).status,'recorded');
  }
  assert.equal(receiptCount(),'1');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE registration_id='${intent.registration_id}';`),'0');
  console.log(JSON.stringify({cash112_overlap:scenario,request:intent.request_id,passed:true}));
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
console.log('CASH112_TRUE_OVERLAP_RECORD_CANCEL_LEGACY_BOTH_ORDERS_PASS');
