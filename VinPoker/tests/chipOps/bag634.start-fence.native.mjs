import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_BAG634_START_FENCE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',table='d294f4a4-082b-4efc-a6ca-1f96579ea344',session='ee2b9393-0c96-42f9-8667-7f306edeb9bc';
const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM floor_private.bag_active_hand_backup271 b WHERE md5(replace(pg_get_functiondef(to_regprocedure(b.signature)),chr(13),''))=b.after_digest;"),'2');
assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='in_progress';`),'0');
assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${tour}';`),'0');
const context=JSON.parse(sql(`SELECT jsonb_build_object('epoch',control_epoch,'number',(SELECT coalesce(max(hand_number),0)+1 FROM public.tournament_hands WHERE tournament_id='${tour}')) FROM public.table_sessions WHERE id='${session}' AND closed_at IS NULL AND control_mode='tracker';`));
assert.ok(Number.isSafeInteger(context.epoch)&&Number.isSafeInteger(context.number));
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
const before=fingerprint();
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>{out+=String(b);});child.stderr.on('data',b=>{err+=String(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(`bag634:${code}:${err}`)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('bag634 barrier:'+label);};
for(const operation of ['record','close']){
 const first=worker();let second,released=false;
 try{
  first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='30s';SET LOCAL application_name='bag634-${operation}-start';${auth}
   SELECT public.start_tracker_hand_v3('${tour}','${table}','${session}',${context.epoch},${context.number},now(),'${actor}',1);
   SELECT 'BAG634_START_READY';\n`);
  await until(()=>first.output().includes('BAG634_START_READY'),operation+' actual canonical start');
  const started=JSON.parse(first.output().split(/\r?\n/).find(x=>x.startsWith('{')));assert.equal(started.status,'success');
  second=worker();
  const call=operation==='record'?`public.chip_ops_record_bag('${tour}',1,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103','BAG634-ROLLBACK',NULL,true)`
   :`public.chip_ops_close_day('${tour}',1,0,false,NULL)`;
  second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='bag634-${operation}-contender';${auth}SELECT ${call};ROLLBACK;\n`);
  await until(()=>sql(`SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='bag634-${operation}-contender' AND a.application_name='bag634-${operation}-start' AND b.wait_event_type='Lock' AND b.wait_event IN('transactionid','tuple');`)==='1',operation+' actual tournament row wait');
  console.log('BAG634_ACTUAL_CANONICAL_START_BLOCKS_LEGACY',operation);
  // Abort the negative hand. No extra retained hand is manufactured; contender
  // must see the post-rollback state and itself rolls back every possible write.
  first.child.stdin.end('ROLLBACK;\n');released=true;
  const [,out]=await Promise.all([first.done,second.done]);
  const result=JSON.parse(out.split(/\r?\n/).find(x=>x.startsWith('{')));
  if(operation==='record')assert.equal(result.status,'ok');else assert.equal(result.error,'VARIANCE_NONZERO');
 }finally{
  if(!released&&!first.child.stdin.writableEnded)first.child.stdin.end('ROLLBACK;\n');
  await first.done.catch(()=>{});if(second)await second.done.catch(()=>{});
  assert.equal(fingerprint(),before,'full ten facts changed');
 }
}
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction';"),'0');
console.log('BAG634_TWO_TRUE_ROW_LOCK_WAITS_START_ROLLBACK_FRESH_STATE_TEN_FACTS_RESTORED_PASS');
