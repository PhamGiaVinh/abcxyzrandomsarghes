import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_CLOSE672_OVERLAP,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM floor_private.dealer_close_pre274;"),'7');
assert.equal(sql("SELECT count(*) FROM public.table_sessions WHERE id='f60106c2-7ed5-4be3-8512-602b16eddff3' AND revision=2 AND closed_at IS NULL;"),'1');
const auth="SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;";
const schedule='4ef20172-1278-4395-90a4-d46325c08426';
const close="SELECT public.floor_break_table_v5(p_tournament_table_id=>'4f493b5e-ef25-4e55-bafd-faab24fcade9',p_expected_revision=>2,p_draw_mode=>'fill_lowest_table',p_request_id=>'381733df-5402-4e27-bb62-536f01abc675',p_plan_hash=>'ddb1a1e6102e50beaa327e9b07cdd1a4');";
const cancel=`SELECT public.cancel_rotation_slot('${schedule}','overlap_TEST');`;
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_rotation_schedule a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.table_sessions a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tournament_seats a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tournament_entries a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.cashier_buyin_movements a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.chip_inventory_ledger a),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY to_jsonb(a)::text) FROM public.table_operation_receipts a)
 )::text);`);
const before=fingerprint();
const workers=[];
function worker(name,query,hold){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let output='',error='';
 child.stdout.on('data',b=>{output+=String(b);});child.stderr.on('data',b=>{error+=String(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(output):reject(Error(`${name}:${code}:${error}`)));});
 done.catch(()=>{});
 const w={child,done,output:()=>output};workers.push(w);
 child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='25s';SET LOCAL application_name='${name}';${auth}${query}\n`);
 if(!hold)child.stdin.end('ROLLBACK;\n');
 return w;
}
async function until(check,label){for(let i=0;i<50;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('close672 missing true-overlap barrier: '+label);}
const blocked=(waiter,holder)=>sql(`SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='${waiter}' AND a.application_name='${holder}' AND b.wait_event_type='Lock';`)==='1';
try{
 // Hold only the schedule, then start Floor. Floor must wait BEFORE owning an
 // assignment; otherwise the holder's canonical cancel creates the reverse edge.
 // Root takes only a deterministic diagnostic row lock. The cancellation
 // itself still executes as the real authenticated operator, not as root.
 const first=worker('close672-plan-holder',`RESET ROLE;SELECT id FROM public.dealer_rotation_schedule WHERE id='${schedule}' FOR UPDATE;${auth}SELECT 'CLOSE672_READY';`,true);
 await until(()=>first.output().includes('CLOSE672_READY'),'schedule held');
 assert.ok(first.output().includes(schedule),'barrier must actually lock a row, not merely print READY');
 const floor=worker('close672-floor-waiter',close,false);
 await until(()=>blocked('close672-floor-waiter','close672-plan-holder'),'Floor blocked on schedule');
 first.child.stdin.end(cancel+'ROLLBACK;\n');
 const [a,b]=await Promise.all([first.done,floor.done]);
 assert.match(a,/"outcome": "cancelled"/);assert.match(b,/"closed": true/);
 assert.equal(fingerprint(),before);
 console.log('CLOSE672_SCHEDULE_HELD_FLOOR_WAIT_CANCEL_NO_ASSIGNMENT_INVERSION_ROLLBACK_PASS');

 const holder=worker('close672-floor-holder',close+"SELECT 'CLOSE672_CLOSED';",true);
 await until(()=>holder.output().includes('CLOSE672_CLOSED'),'Floor transaction actually closed');
 const late=worker('close672-cancel-waiter',cancel,false);
 await until(()=>blocked('close672-cancel-waiter','close672-floor-holder'),'cancel blocked on Floor');
 holder.child.stdin.end('ROLLBACK;\n');
 const [c,d]=await Promise.all([holder.done,late.done]);
 assert.match(c,/"closed": true/);assert.match(d,/"outcome": "cancelled"/);
 assert.equal(fingerprint(),before);
 console.log('CLOSE672_FLOOR_HELD_LATE_CANCEL_WAIT_REVALIDATE_ROLLBACK_PASS');
}finally{
 for(const w of workers)if(!w.child.stdin.writableEnded)w.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled(workers.map(w=>w.done));
 assert.equal(fingerprint(),before,'all tested business rows/receipts must roll back');
}
console.log('CLOSE672_TWO_TRUE_OVERLAP_ORDERS_NO_DURABLE_TEST_WRITE_PASS');
