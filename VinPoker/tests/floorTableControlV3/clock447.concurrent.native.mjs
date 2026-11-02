import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.floor_control_tournament_clock(uuid,text,integer,text)'::regprocedure;"),'8b5f4b81fc5225334e4f1635e0a1dff5');
const actor='e4240000-0000-4000-8000-000000000001',club='e4240000-0000-4000-8000-000000000010',tour='e4470000-0000-4000-8000-000000000020';
assert.equal(sql(`SELECT count(*) FROM public.clubs c JOIN public.club_settings s ON s.club_id=c.id WHERE c.id='${club}' AND c.owner_id='${actor}' AND NOT s.auto_swing_enabled;`),'1');
assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${tour}';`),'0','one-shot fixture: never reset/rerun');
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
const outside=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t WHERE id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a WHERE entity_id IS DISTINCT FROM '${tour}'::uuid),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h),
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cashier_buyin_movements c),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p))::text);`);
const before=outside();
sql(`BEGIN;INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level,clock_started_at,clock_paused_at,pause_accumulated)
 VALUES('${tour}','${club}','Clock447 isolated concurrency TEST','live','playing',1,'2026-10-23 10:19:49.4+00','2026-10-23 10:20:00+00',0);
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes,is_break)
 VALUES('${tour}',1,100,200,0,20,false);COMMIT;`);
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',x=>{out+=x;});child.stderr.setEncoding('utf8').on('data',x=>{err+=x;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(new Error(err)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<60;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`clock447 missing barrier ${label}`);};
try{
 for(const [index,delta] of [-60,60].entries()){
  const snapshot=call(`SELECT public.get_tournament_clock('${tour}');`);
  const statement=`SELECT public.floor_control_tournament_clock('${tour}','adjust_time',${delta},'${snapshot.control_revision}');`;
  const first=worker();let second,released=false;
  try{
   first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='clock447-${index}-first';${auth}${statement}SELECT 'CLOCK447_STAGED';\n`);
   await until(()=>first.output().includes('CLOCK447_STAGED'),'staged');
   second=worker();second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='clock447-${index}-second';${auth}${statement}COMMIT;\n`);
   await until(()=>sql(`SELECT count(*) FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='clock447-${index}-second' AND h.application_name='clock447-${index}-first' AND w.wait_event_type='Lock';`)==='1','actual lock overlap');
   first.child.stdin.end('COMMIT;\n');released=true;
   const values=(await Promise.all([first.done,second.done])).map(out=>JSON.parse(out.split(/\r?\n/).find(x=>x.startsWith('{'))));
   assert.equal(values[0].ok,true);assert.equal(values[0].changed,true);assert.equal(values[1].error,'stale_clock_state');
   const after=call(`SELECT public.get_tournament_clock('${tour}');`);
   assert.equal(after.remaining_seconds,snapshot.remaining_seconds+delta);
   assert.equal(after.control_revision,values[0].control_revision);
   const retry=call(statement);assert.equal(retry.error,'stale_clock_state');
   assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${tour}' AND action='floor_tournament_clock_controlled';`),String(index+1));
   console.log(`CLOCK447_DELTA_${delta}_PG_BLOCKING_ONE_COMMIT_STALE_WAITER_RETRY_PASS`);
  }finally{
   if(!released){if(!first.child.stdin.writableEnded)first.child.stdin.end('ROLLBACK;\n');await first.done.catch(()=>{});if(second)await second.done.catch(()=>{});}
  }
 }
 assert.equal(call(`SELECT public.get_tournament_clock('${tour}');`).remaining_seconds,1189);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`),'0');
 assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}';`),'f');
 console.log('CLOCK447_BOTH_DELTAS_RETAINED_AUDIT2_NO_ENTRIES');
}finally{
 assert.equal(outside(),before,'outside clock canary changed');
 console.log('CLOCK447_OTHER_TOURS_AUDIT_HANDS_CASH_PRIZES_UNCHANGED');
}
