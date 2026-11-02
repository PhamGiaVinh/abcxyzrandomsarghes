import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
// Exact local-only retained journey; native psql sessions, no Docker or provider.
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=text=>{
 const r=spawnSync('wsl.exe',args,{input:text,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:2**20});
 assert.equal(r.status,0,r.stderr||String(r.error));return r.stdout.trim();
};
const auth="SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{" +
 '"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"' + "}';SET LOCAL ROLE authenticated;";
const table='8ce69933-b2d0-4dfe-962e-86709c6222ac',sessionId='c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55';
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.table_sessions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_assignments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.dealer_attendance x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,operation_type,request_id) FROM public.table_operation_receipts x),
 (SELECT jsonb_agg(to_jsonb(x)) FROM public.multi_day_package_release_v1 x))::text);`);
function connect(name){
 const child=spawn('wsl.exe',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const closed=new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err||`psql_exit_${code}`)));
 });
 // Attach immediately so an early process failure cannot become unhandled.
 closed.catch(()=>{});
 child.stdin.write(`SET application_name='${name}';SET statement_timeout='12s';\n`);
 return {child,closed,output:()=>out};
}
async function until(probe){
 const end=Date.now()+10000;
 while(Date.now()<end){if(probe())return;await new Promise(resolve=>setTimeout(resolve,60));}
 throw Error('release178_barrier_timeout');
}
assert.equal(sql("SELECT current_database()||':'||host(inet_server_addr())||':'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c:127.0.0.1:55441');
assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.release_bagged_flight_table_v1(uuid,uuid,bigint,text,integer,uuid)'::regprocedure),chr(13),''));"),'2def3d435c90a7567a9bf3a9ba5660ca');
assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id='${table}' AND is_active;`),'8');
const before=fingerprint();let holder,waiter;
try{
 holder=connect('release178_close_holder');
 holder.child.stdin.write(`BEGIN;${auth}SELECT 'CLOSE:'||public.close_tournament_table_v4('${table}',10,'17800000-0000-4000-8000-000000000020')::text;
 RESET ROLE;SELECT 'HOLDER_PID:'||pg_backend_pid();\n\\echo HELD\n`);
 await until(()=>holder.output().includes('HELD'));
 const close=JSON.parse(holder.output().split('\n').find(x=>x.startsWith('CLOSE:')).slice(6));
 assert.deepEqual(close,{ok:false,error:'table_not_empty'});
 const holderPid=Number(holder.output().split('\n').find(x=>x.startsWith('HOLDER_PID:')).slice(11));
 assert.ok(Number.isSafeInteger(holderPid)&&holderPid>0);
 waiter=connect('release178_release_waiter');
 waiter.child.stdin.end(`BEGIN;
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;
 ${auth}SELECT 'RELEASE:'||public.release_bagged_flight_table_v1('${table}','${sessionId}',10,'9b83697a48dba8fac105ffbf058147a1',1,'17800000-0000-4000-8000-000000000021')::text;
 ROLLBACK;\n`);
 // Barrier proves the real canonical close is blocking release, not the flag:
 // only waiter updates the package row; holder never touches that row.
 await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name='release178_release_waiter'
  AND a.wait_event_type='Lock' AND ${holderPid}=ANY(pg_blocking_pids(a.pid)));`)==='t');
 holder.child.stdin.end('ROLLBACK;\n');await holder.closed;
 const output=await waiter.closed;
 const release=JSON.parse(output.split('\n').find(x=>x.startsWith('RELEASE:')).slice(8));
 assert.equal(release.closed,true);assert.equal(release.status,'bagged');assert.equal(release.releasedPlayers,8);
 assert.equal(release.baggedTotal,160000);
 assert.equal(fingerprint(),before,'rollback contention must leave all business facts, gate and receipts unchanged');
 console.log('RELEASE178_CANONICAL_CLOSE_TRUE_LOCK_OVERLAP_ROLLBACK_PASS',JSON.stringify({holderPid,table,session:sessionId,retainedBusinessWrites:0,
  limitation:'First transaction rolled back; not committed duplicate/reopen or Swing-worker acceptance.'}));
}finally{
 for(const h of [holder,waiter])if(h){
  if(!h.child.stdin.writableEnded&&!h.child.stdin.destroyed)h.child.stdin.end('ROLLBACK;\n');
  await h.closed.catch(()=>{});
 }
}
