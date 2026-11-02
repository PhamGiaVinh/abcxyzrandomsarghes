import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_BAG624_SERIALIZATION,'1');
assert.ok(process.argv.slice(2).every(x=>x==='--additional-orders'));
const additional=process.argv.includes('--additional-orders');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const tour='e6220000-0000-4000-8000-000000000001',bag='e6220000-0000-4000-8000-000000000002';
const auth="SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;";
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql(`SELECT count(*) FROM public.day_close WHERE tournament_id='${tour}' AND day_number=1 AND status='open' AND version=${additional?4:2};`),'1','one-shot continuation of compensated622/624; do not reset');
assert.equal(sql(`SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id='${tour}';`),additional?'6':'4');
assert.equal(sql(`SELECT count(*) FROM floor_private.bag_day_lock_backup269;`),'5','reviewed269 must be installed');
const beforeBag=sql(`SELECT to_jsonb(b) FROM public.chip_bag b WHERE id='${bag}';`);
const outside=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);`);
const before=outside();
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>{out+=String(b);});child.stderr.on('data',b=>{err+=String(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(`bag624:${code}:${err}`)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('bag624 barrier:'+label);};
if(additional){
 assert.equal(sql(`SELECT count(*) FROM public.day_close WHERE tournament_id='${tour}' AND day_number=2;`),'0');
 const pair=async(tag,day,firstSql,secondSql)=>{
  const first=worker();let second,released=false;
  try{
   first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='bag625-${tag}-first';${auth}${firstSql}SELECT 'BAG625_READY';\n`);
   await until(()=>first.output().includes('BAG625_READY'),tag+' first RPC');
   second=worker();second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='bag625-${tag}-second';${auth}${secondSql}COMMIT;\n`);
   await until(()=>sql(`SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='bag625-${tag}-second' AND a.application_name='bag625-${tag}-first' AND b.wait_event_type='Lock' AND b.wait_event='advisory';`)==='1',tag+' actual advisory wait');
   console.log('BAG625_REAL_ADVISORY_WAIT',tag);
   first.child.stdin.end('COMMIT;\n');released=true;
   return await Promise.all([first.done,second.done]).then(outputs=>outputs.map(out=>JSON.parse(out.split(/\r?\n/).find(x=>x.startsWith('{')))));
  }finally{
   if(!released&&!first.child.stdin.writableEnded)first.child.stdin.end('ROLLBACK;\n');
   await first.done.catch(()=>{});if(second)await second.done.catch(()=>{});
   const current=JSON.parse(sql(`SELECT coalesce((SELECT to_jsonb(d) FROM public.day_close d WHERE tournament_id='${tour}' AND day_number=${day}),'null'::jsonb);`));
   if(current?.status==='locked')assert.equal(JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_reopen_day('${tour}',${day},${current.version});COMMIT;`)).status,'ok');
   assert.equal(outside(),before);
  }
 };
 const reverse=await pair('unseal-first',1,`SELECT public.chip_ops_unseal_bag('${bag}');`,
  `SELECT public.chip_ops_close_day('${tour}',1,4,false,NULL);`);
 assert.equal(reverse[0].status,'ok');assert.equal(reverse[1].status,'ok');assert.equal(reverse[1].total_counted_value,0);
 const firstDay=await pair('first-close',2,`SELECT public.chip_ops_close_day('${tour}',2,0,false,NULL);`,
  `SELECT public.chip_ops_record_bag('${tour}',2,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','BAG625-TEST',1000,true);`);
 assert.equal(firstDay[0].status,'ok');assert.equal(firstDay[1].error,'DAY_LOCKED');
 assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${tour}' AND day_number=2;`),'0');
 assert.equal(sql(`SELECT status||':'||version FROM public.day_close WHERE tournament_id='${tour}' AND day_number=1;`),'open:6');
 assert.equal(sql(`SELECT status||':'||version FROM public.day_close WHERE tournament_id='${tour}' AND day_number=2;`),'open:2');
 assert.equal(sql(`SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id='${tour}';`),'11');
 const prior=JSON.parse(beforeBag),after=JSON.parse(sql(`SELECT to_jsonb(b) FROM public.chip_bag b WHERE id='${bag}';`));
 delete prior.updated_at;delete after.updated_at;assert.deepEqual(after,prior);
 console.log('BAG625_REVERSE_ORDER_FIRST_DAY_BLOCKED_RECORD_CANONICAL_COMPENSATIONS_OUTSIDE_UNCHANGED_PASS',JSON.stringify({reverse,firstDay}));
}else{
const first=worker();let second,released=false;
try{
 first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='bag624-close';${auth}
 DO $$ DECLARE r jsonb;BEGIN r:=public.chip_ops_reopen_day('${tour}',1,2);ASSERT r->>'status'='ok' AND r->>'idempotent'='true';END $$;
 SELECT 'BAG624_ACTUAL_RPC_HOLDS_LOCK';\n`);
 await until(()=>first.output().includes('BAG624_ACTUAL_RPC_HOLDS_LOCK'),'holder actual RPC');
 second=worker();second.child.stdin.end(`BEGIN;SET LOCAL application_name='bag624-unseal';SET LOCAL statement_timeout='10s';${auth}SELECT public.chip_ops_unseal_bag('${bag}');COMMIT;\n`);
 await until(()=>sql("SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='bag624-unseal' AND a.application_name='bag624-close' AND b.wait_event_type='Lock' AND b.wait_event='advisory';")==='1','actual advisory wait BEFORE unseal');
 console.log('BAG624_TRUE_ADVISORY_WAIT_ACTUAL_PUBLIC_RPC_CONFIRMED');
 first.child.stdin.end(`SELECT public.chip_ops_close_day('${tour}',1,2,false,NULL);COMMIT;\n`);released=true;
 const [a,b]=await Promise.all([first.done,second.done]);
 const close=JSON.parse(a.split(/\r?\n/).find(x=>x.startsWith('{'))),unseal=JSON.parse(b.split(/\r?\n/).find(x=>x.startsWith('{')));
 assert.equal(close.status,'ok');assert.equal(unseal.error,'REOPEN_FIRST');
 assert.equal(sql(`SELECT to_jsonb(b) FROM public.chip_bag b WHERE id='${bag}';`),beforeBag,'denied unseal changed bag');
 assert.equal(sql(`SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id='${tour}' AND action='unseal';`),'1','denied unseal appended audit');
 console.log('BAG624_CLOSE_COMMIT_THEN_UNSEAL_REJECTED_NO_BAG_OR_UNSEAL_AUDIT_DELTA',JSON.stringify({close,unseal}));
}finally{
 if(!released&&!first.child.stdin.writableEnded)first.child.stdin.end('ROLLBACK;\n');
 await first.done.catch(()=>{});if(second)await second.done.catch(()=>{});
 const day=JSON.parse(sql(`SELECT to_jsonb(d) FROM public.day_close d WHERE tournament_id='${tour}' AND day_number=1;`));
 if(day.status==='locked')assert.equal(JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_reopen_day('${tour}',1,${day.version});COMMIT;`)).status,'ok');
 assert.equal(outside(),before);assert.equal(sql(`SELECT to_jsonb(b) FROM public.chip_bag b WHERE id='${bag}';`),beforeBag);
}
assert.equal(sql(`SELECT status||':'||version FROM public.day_close WHERE tournament_id='${tour}' AND day_number=1;`),'open:4');
assert.equal(sql(`SELECT count(*) FROM public.chip_ops_signoff_audit WHERE tournament_id='${tour}';`),'6');
console.log('BAG624_REAL_TWO_SESSION_SERIALIZATION_CANONICAL_COMPENSATION_OUTSIDE_UNCHANGED_PASS');
}
