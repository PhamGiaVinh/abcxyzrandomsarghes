import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_BAG631_CONCURRENCY,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',tour='46cab483-91e7-4220-aacf-e17bdf05269c';
const ownTour='e6220000-0000-4000-8000-000000000001',ownBag='e6220000-0000-4000-8000-000000000002';
const keys=[1,2,3].map(n=>`e6310000-0000-4000-8000-00000000000${n}`);
const literal=x=>`'${String(x).replaceAll("'","''")}'`;
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)'::regprocedure),chr(13),''));"),'22bf8a1b1ee90c116d6ad2908e85cf09');
assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE request_key IN(${keys.map(literal)});`),'0','one-shot; never erase receipts to rerun');
assert.equal(sql(`SELECT count(*) FROM public.day_close WHERE tournament_id='${ownTour}' AND day_number=1 AND status='open' AND version=6;`),'1');
assert.equal(sql(`SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id='${ownTour}';`),'11');
assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${tour}';`),'0');
const beforeBag=JSON.parse(sql(`SELECT to_jsonb(b) FROM public.chip_bag b WHERE id='${ownBag}';`));
assert.equal(beforeBag.sealed,false);assert.equal(beforeBag.total_value,1000);
const outside=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x WHERE id<>'${ownBag}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x WHERE tournament_id<>'${ownTour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x WHERE request_key NOT IN(${keys.map(literal)})),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);`);
const before=outside();
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>{out+=String(b);});child.stderr.on('data',b=>{err+=String(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(`bag631:${code}:${err}`)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('bag631 barrier:'+label);};
const call=(scope,operation,payload,key,action)=>`SELECT public.chip_ops_bag_intent_v1('${scope}',1,${literal(operation)},${literal(JSON.stringify(payload))}::jsonb,'${key}','${actor}',${literal(action)});`;
const pair=async(tag,firstQuery,secondQuery)=>{
 const first=worker();let second,released=false;
 try{
  first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='30s';SET LOCAL application_name='bag631-${tag}-first';${auth}${firstQuery}SELECT 'BAG631_READY';\n`);
  await until(()=>first.output().includes('BAG631_READY'),tag+' first actual RPC');
  second=worker();
  // Always roll back the contender. A failed harness barrier must never leave
  // an unintended positive record on the original46 journey.
  second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='bag631-${tag}-second';${auth}${secondQuery}ROLLBACK;\n`);
  await until(()=>sql(`SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='bag631-${tag}-second' AND a.application_name='bag631-${tag}-first' AND b.wait_event_type='Lock' AND b.wait_event='advisory';`)==='1',tag+' actual advisory wait');
  console.log('BAG631_ACTUAL_RPC_BLOCKER_CONFIRMED',tag);
  first.child.stdin.end('COMMIT;\n');released=true;
  const results=await Promise.all([first.done,second.done]);
  return results.map(out=>JSON.parse(out.split(/\r?\n/).find(line=>line.startsWith('{'))));
 }finally{
  if(!released&&!first.child.stdin.writableEnded)first.child.stdin.end('ROLLBACK;\n');
  await first.done.catch(()=>{});if(second)await second.done.catch(()=>{});
  assert.equal(outside(),before,'outside facts changed');
 }
};
const record={player_id:'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',bag_code:'BAG631-NOT-WRITTEN',total_value:58900,seal:true};
const cancelled=await pair('cancel-first',call(tour,'record',record,keys[0],'cancel'),call(tour,'record',record,keys[0],'write'));
assert.equal(cancelled[0].result.error,'REQUEST_CANCELLED');assert.deepEqual(cancelled[1],cancelled[0]);
const written=await pair('write-first',call(ownTour,'unseal',{bag_id:ownBag},keys[1],'write'),call(ownTour,'unseal',{bag_id:ownBag},keys[1],'cancel'));
assert.equal(written[0].result.status,'ok');assert.deepEqual(written[1],written[0]);
const changed=await pair('changed-payload',call(tour,'record',record,keys[2],'cancel'),call(tour,'record',{...record,total_value:58800},keys[2],'write'));
assert.equal(changed[0].result.error,'REQUEST_CANCELLED');assert.equal(changed[1].error,'IDEMPOTENCY_CONFLICT');
const afterBag=JSON.parse(sql(`SELECT to_jsonb(b) FROM public.chip_bag b WHERE id='${ownBag}';`));
delete beforeBag.updated_at;delete afterBag.updated_at;assert.deepEqual(afterBag,beforeBag);
assert.equal(sql(`SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id='${ownTour}';`),'12');
assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE request_key IN(${keys.map(literal)});`),'3');
assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${tour}';`),'0');
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction';"),'0');
console.log('BAG631_THREE_REAL_TWO_SESSION_ORDERS_PASS_RETAIN_THREE_RECEIPTS_ONE_OWN_AUDIT_NO_OUTSIDE_DELTA');
