import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_ONLINE770_NATIVE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT to_regclass('floor_private.online770_concurrency') IS NULL AND to_regclass('private.online_create_requests_v1') IS NULL;"),'t','consumed qualification; preserve all evidence');
assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND state<>'idle';"),'0');
assert.equal(sql("SELECT count(*) FROM public.online_poker_config;"),'0');
const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const tables=JSON.parse(sql("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'fnb\\_%' ESCAPE '\\' OR tablename IN('cashier_buyin_movements','tournament_prize_payments','tournament_entries','tournament_seats'));"));
assert.ok(tables.length>4);
const proof=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."${t.replaceAll('"','""')}" x)`).join(',')})::text);`);
const before=proof(),rows=[];
sql(`CREATE TABLE floor_private.online770_concurrency(stage text PRIMARY KEY,evidence jsonb NOT NULL);ALTER TABLE floor_private.online770_concurrency ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.online770_concurrency FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.online770_concurrency VALUES('start',jsonb_build_object('testOnly',true,'protectedBefore',${quote(before)}));`);
const record=(stage,value)=>sql(`INSERT INTO floor_private.online770_concurrency VALUES(${quote(stage)},${quote(JSON.stringify(value))}::jsonb);`);
sql(readFileSync(new URL('../../supabase/migrations/20270128000287_online_create_receipt_v1.sql',import.meta.url),'utf8'));
sql('INSERT INTO public.online_poker_config(id,enabled) VALUES(true,true);');
const enabled=sql('SELECT to_jsonb(g) FROM public.online_poker_config g WHERE id;');
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
function session(name){const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',v=>{out+=v;});child.stderr.on('data',v=>{err+=v;});const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(err)));});void done.catch(()=>{});return {child,done,out:()=>out,name};}
async function until(check){const end=Date.now()+10000;while(!check()){assert.ok(Date.now()<end,'actual overlap barrier not observed');await new Promise(r=>setTimeout(r,30));}}
const receipts=out=>out.split(/\r?\n/).filter(v=>v.startsWith('{')).map(v=>JSON.parse(v));
let a,b;
try{
 for(const conflict of [false,true]){
  const key=randomUUID(),name=conflict?'LOCAL770-CONFLICT':'LOCAL770-REPLAY';
  const call=amount=>`SELECT public.op_create_open_table_v2('${name}',25,50,${amount},9,'${key}');`;
  a=session('online770-holder');b=session('online770-waiter');
  a.child.stdin.write(`SET application_name='${a.name}';BEGIN;SET LOCAL statement_timeout='15s';${auth}${call(5000)}SELECT 'ONLINE770_HOLDER_READY';\n`);
  await until(()=>a.out().includes('ONLINE770_HOLDER_READY'));
  b.child.stdin.end(`SET application_name='${b.name}';BEGIN;SET LOCAL statement_timeout='15s';${auth}${call(conflict?6000:5000)}COMMIT;\n`);
  await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.datname=current_database() AND w.application_name='${b.name}' AND h.application_name='${a.name}' AND w.wait_event_type='Lock');`)==='t');
  const pending=JSON.parse(sql(`BEGIN;${auth}SELECT public.op_get_create_receipt_v1('${key}');ROLLBACK;`));
  assert.equal(pending.outcome,'not_found','uncommitted receipt must not masquerade as committed success');
  a.child.stdin.end('COMMIT;\n');const first=receipts(await a.done)[0];
  assert.equal(first.outcome,'ok');let second;
  if(conflict){second=await b.done.then(()=>{throw Error('conflicting waiter unexpectedly succeeded');},error=>({error:error.message}));assert.ok(second.error.includes('online_create_request_conflict'));}
  else{second=receipts(await b.done)[0];assert.equal(second.table_id,first.table_id);assert.equal(second.replayed,true);}
  const recovered=JSON.parse(sql(`BEGIN;${auth}SELECT public.op_get_create_receipt_v1('${key}');ROLLBACK;`));
  assert.equal(recovered.outcome,'found');assert.equal(recovered.receipt.table_id,first.table_id);
  assert.equal(sql(`SELECT count(*) FROM public.online_poker_tables WHERE name='${name}';`),'1');
  rows.push({key,name,observedActualWait:true,pendingRead:pending,first,second,recovered});record(conflict?'conflict':'replay',rows.at(-1));
  console.log('ONLINE770_ACTUAL_OVERLAP_PASS',conflict?'CONFLICT':'REPLAY');
 }
 assert.equal(sql('SELECT count(*) FROM private.online_create_requests_v1;'),'2');
 assert.equal(sql("SELECT count(*) FROM public.online_poker_seats WHERE table_id IN(SELECT id FROM public.online_poker_tables WHERE name IN('LOCAL770-CONFLICT','LOCAL770-REPLAY')) AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6' AND stack=5000;"),'2');
}catch(error){record('failure',{error:String(error.message),completed:rows});throw error;}
finally{
 for(const s of[a,b])if(s&&!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');await Promise.allSettled([a?.done,b?.done]);
 const removed=sql(`WITH removed AS(DELETE FROM public.online_poker_config g WHERE g.id AND to_jsonb(g)=${quote(enabled)}::jsonb RETURNING 1)SELECT count(*) FROM removed;`);
 assert.equal(removed,'1','unknown config delta; do not reset');assert.equal(proof(),before,'FNB/original financial/entry/seat state changed');
 record('protected-final',{fingerprint:proof(),configRows:Number(sql('SELECT count(*) FROM public.online_poker_config;'))});
 console.log('ONLINE770_OWNED_CLONE_ALL_FNB_MONEY_ENTRIES_SEATS_UNCHANGED_CONFIG_RESTORED_RETAIN_NEW_ONLINE_EVIDENCE');
}
