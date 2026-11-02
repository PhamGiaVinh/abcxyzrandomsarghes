import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_BAG622_RACE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const tour='e6220000-0000-4000-8000-000000000001',bag='e6220000-0000-4000-8000-000000000002';
assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${tour}';`),'0','one-shot negative fixture, never reset/rerun');
const outside=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x))::text);`);
const before=outside(),auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
sql(`BEGIN;
 INSERT INTO public.tournaments(id,club_id,name,status,live_status)
 SELECT '${tour}','${club}','Bag622 isolated negative TEST',status,live_status FROM public.tournaments WHERE id='4cd3af4d-7e1d-4042-855f-04fb6777e580';
 INSERT INTO public.day_close(tournament_id,club_id,day_number,status,version) VALUES('${tour}','${club}',1,'open',0);
 INSERT INTO public.chip_bag(id,tournament_id,club_id,day_number,player_id,stack_value,total_value,sealed,bag_code,created_by)
 VALUES('${bag}','${tour}','${club}',1,'5f4dd4c4-a9d0-43a9-b523-ab5ec5d3c103',1000,1000,true,'BAG622-HISTORICAL-TEST','${actor}');
 COMMIT;`);
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>{out+=String(b);});child.stderr.on('data',b=>{err+=String(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(`bag622:${code}:${err}`)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('bag622 barrier:'+label);};
const holder=worker();let contender,released=false,violation=false;
try{
 holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='bag622-holder';LOCK TABLE public.chip_bag IN SHARE MODE;SELECT 'BAG622_READY';\n`);
 await until(()=>holder.output().includes('BAG622_READY'),'holder lock');
 contender=worker();contender.child.stdin.end(`BEGIN;SET LOCAL application_name='bag622-unseal';SET LOCAL statement_timeout='10s';${auth}SELECT public.chip_ops_unseal_bag('${bag}');COMMIT;\n`);
 await until(()=>sql("SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='bag622-unseal' AND a.application_name='bag622-holder' AND b.wait_event_type='Lock';")==='1','actual unseal blocked after guard');
 console.log('BAG622_ACTUAL_PG_BLOCKING_UNSEAL_AFTER_DAY_GUARD');
 holder.child.stdin.end(`${auth}SELECT public.chip_ops_close_day('${tour}',1,0,true,'TEST622 historical sealed-only negative fixture');COMMIT;\n`);released=true;
 const [a,b]=await Promise.all([holder.done,contender.done]);
 const close=JSON.parse(a.split(/\r?\n/).find(x=>x.startsWith('{'))),unseal=JSON.parse(b.split(/\r?\n/).find(x=>x.startsWith('{')));
 const actual=JSON.parse(sql(`SELECT jsonb_build_object('day',d.status,'version',d.version,'bagSealed',b.sealed,'countedSnapshot',d.counted_total_value) FROM public.day_close d JOIN public.chip_bag b ON b.tournament_id=d.tournament_id AND b.day_number=d.day_number WHERE b.id='${bag}';`));
 console.log('BAG622_ACTUAL_RESULTS',JSON.stringify({tour,bag,close,unseal,actual}));
 violation=close.status==='ok'&&unseal.status==='ok'&&actual.day==='locked'&&actual.bagSealed===false;
}finally{
 if(!released&&!holder.child.stdin.writableEnded)holder.child.stdin.end('ROLLBACK;\n');
 await holder.done.catch(()=>{});if(contender)await contender.done.catch(()=>{});
 const state=JSON.parse(sql(`SELECT to_jsonb(d) FROM public.day_close d WHERE tournament_id='${tour}' AND day_number=1;`));
 if(state.status==='locked'){
  const compensation=JSON.parse(sql(`BEGIN;${auth}SELECT public.chip_ops_reopen_day('${tour}',1,${state.version});COMMIT;`));
  assert.equal(compensation.status,'ok');
 }
 assert.equal(outside(),before,'outside negative fixture changed');
 assert.equal(sql(`SELECT status FROM public.day_close WHERE tournament_id='${tour}' AND day_number=1;`),'open');
 console.log('BAG622_OWN_FIXTURE_CANONICAL_REOPEN_COMPENSATION_OUTSIDE_UNCHANGED');
}
assert.equal(violation,false,'BAG622_UNSEAL_COMMITTED_AFTER_DAY_LOCK');
