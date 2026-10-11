import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
const closeSession=process.argv.includes('--close-session');
const closeFirst=process.argv.includes('--floor-close');
const voidBeforeClose=process.argv.includes('--floor-close-void-first');
const voidFirst=process.argv.includes('--floor-move-void-first')||voidBeforeClose;
const floorMove=process.argv.includes('--floor-move')||process.argv.includes('--floor-move-void-first');
const moveSeat=process.argv.includes('--move-seat')||floorMove;
const duplicateVoid=process.argv.includes('--duplicate-void');
assert.ok([closeSession,moveSeat,duplicateVoid,closeFirst,voidBeforeClose].filter(Boolean).length<=1);
const ownedDatabase=voidBeforeClose?'vinpoker_ops_completed_void59_floor_close_rev_20261011':closeFirst?'vinpoker_ops_completed_void59_floor_close_20261011':voidFirst?'vinpoker_ops_completed_void59_floor_move_reverse_20261011':floorMove?'vinpoker_ops_completed_void59_floor_move_20261011':duplicateVoid?'vinpoker_ops_completed_void59_duplicate_20261011':moveSeat?'vinpoker_ops_completed_void59_move_20261011':closeSession?'vinpoker_ops_completed_void59_close_20261011':'vinpoker_ops_completed_void59_overlap_20261011';
assert.match(process.env.PGDATABASE,new RegExp(`^${ownedDatabase}(?:_rerun[0-9]+)?$`));
assert.ok(process.env.PGDATABASE.length<=63,'database name must not be truncated');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
function sql(q){const r=spawnSync('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql('SELECT current_database();'),process.env.PGDATABASE,'exact isolated database required');
function session(name,q){
 const child=spawn('psql',['-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 child.stdin.write(`SET application_name='${name}';SET statement_timeout='12s';SET idle_in_transaction_session_timeout='15s';${q}\n`);
 return{result,end:q=>{if(!child.stdin.writableEnded)child.stdin.end(q+'\n');}};
}
async function barrier(name,predicate){for(let i=0;i<120;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${predicate});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('barrier missing '+name);}
const probe=readFileSync(new URL('completedVoidProjection.pg17.sql',import.meta.url),'utf8');
const boundary=probe.indexOf('\\if');assert.ok(boundary>0);
// Only the prerequisite setup prefix, never a test's success/error assertion.
if(process.argv.includes('--prepared')){
 assert.equal(sql("SELECT count(*) FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001' AND status='completed' AND NOT is_voided;"),'1');
}else sql(probe.slice(0,boundary).replaceAll('vinpoker_ops_card56_overlap_20261011',process.env.PGDATABASE)+'\nCOMMIT;');
let writer,voider;
if(closeFirst)sql("UPDATE public.tournament_seats SET is_active=false,status='busted' WHERE table_session_id='83500000-0000-4000-8000-000000000001';");
// Ignore only the writer's intentional field change; all void-owned deltas must
// remain visible after COMMIT, including a function returning a JSON error.
function projectionSnapshot(queryOnly=false){const query=`SELECT jsonb_build_object(
 'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE h.id='86000000-0000-4000-8000-000000000001'),
 'entries',(SELECT jsonb_agg(CASE WHEN e.id='85700000-0000-4000-8000-000000000001' AND ${!closeSession&&!moveSeat&&!duplicateVoid&&!closeFirst&&!voidBeforeClose} THEN to_jsonb(e)-'current_stack'-'updated_at' ELSE to_jsonb(e) END ORDER BY e.id) FROM public.tournament_entries e WHERE e.tournament_id=(SELECT tournament_id FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001')),
 'seats',(SELECT jsonb_agg(CASE WHEN s.entry_id='85700000-0000-4000-8000-000000000001' AND ${moveSeat&&!floorMove} THEN to_jsonb(s)-'seat_number'-'updated_at' ELSE to_jsonb(s) END ORDER BY s.id) FROM public.tournament_seats s WHERE s.tournament_id=(SELECT tournament_id FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001')),
 'counts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.tournament_chip_counts c WHERE c.tournament_id=(SELECT tournament_id FROM public.tournament_hands WHERE id='86000000-0000-4000-8000-000000000001')));`;return queryOnly?query:sql(query);}
const before=projectionSnapshot();
const initialStack=Number(sql("SELECT current_stack FROM public.tournament_entries WHERE id='85700000-0000-4000-8000-000000000001';"));
const revision=sql("SELECT revision FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001';");
assert.match(revision,/^[0-9]+$/);
const moveCall=`SELECT public.move_player_seat_v2('85700000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',3,${revision},${revision},'95900000-0000-4000-8000-000000000001');`;
const closeCall=`SELECT public.close_tournament_table_v4('84000000-0000-4000-8000-000000000001',${revision},'95900000-0000-4000-8000-000000000002');`;
try{
 if(voidFirst){
  writer=session('void59_stack_writer',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';SELECT public.void_last_hand('86000000-0000-4000-8000-000000000001');RESET ROLE;${projectionSnapshot(true)}`);
 }else if(closeFirst){
  writer=session('void59_stack_writer',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';${closeCall}RESET ROLE;${projectionSnapshot(true)}`);
 }else if(floorMove){
  const rev=sql("SELECT revision FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001';");
  assert.match(rev,/^[0-9]+$/);
  writer=session('void59_stack_writer',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';SELECT public.move_player_seat_v2('85700000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',3,${rev},${rev},'95900000-0000-4000-8000-000000000001');RESET ROLE;${projectionSnapshot(true)}`);
 }else{
 writer=session('void59_stack_writer',duplicateVoid?`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';SELECT public.void_last_hand('86000000-0000-4000-8000-000000000001');RESET ROLE;${projectionSnapshot(true)}`:moveSeat?`BEGIN;UPDATE public.tournament_seats SET seat_number=3 WHERE entry_id='85700000-0000-4000-8000-000000000001';`:closeSession?`BEGIN;UPDATE public.table_sessions SET closed_at=now() WHERE id='83500000-0000-4000-8000-000000000001';`:`BEGIN;UPDATE public.tournament_entries SET current_stack=current_stack+1000 WHERE id='85700000-0000-4000-8000-000000000001';`);
 }
 await barrier('void59_stack_writer',"wait_event='ClientRead' AND xact_start IS NOT NULL");
 voider=session('void59_operator',`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='81100000-0000-4000-8000-000000000001';${voidBeforeClose?closeCall:voidFirst?moveCall:"SELECT public.void_last_hand('86000000-0000-4000-8000-000000000001');"}COMMIT;`);voider.end('');
 try{await barrier('void59_operator',"wait_event_type='Lock'");}
 catch(e){const escaped=await voider.result;assert.fail(String(e)+' operator escaped conflicting transaction: '+escaped.out+' '+escaped.error);}
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity v JOIN pg_stat_activity w ON w.pid=ANY(pg_blocking_pids(v.pid)) WHERE v.application_name='void59_operator' AND w.application_name='void59_stack_writer');"),'t');
 writer.end('COMMIT;');
 const written=await writer.result;assert.equal(written.code,0,written.error);
 const result=await voider.result;assert.equal(result.code,0,result.error);
 if(closeFirst||voidBeforeClose){
  const lines=written.out.trim().split('\n');
  const first=JSON.parse(lines[0]),second=JSON.parse(result.out.trim());
  if(closeFirst){assert.equal(first.ok,true);assert.equal(second.error,'void_session_mismatch');}
  else{assert.equal(first.status,'success');assert.equal(second.error,'table_not_empty');}
  assert.equal(projectionSnapshot(),lines.at(-1),'denied second operation must preserve first committed projections');
  assert.equal(sql("SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='83500000-0000-4000-8000-000000000001';"),closeFirst?'t':'f');
  console.log(closeFirst?'COMPLETED_VOID_CANONICAL_CLOSE_FIRST_OVERLAP_PASS':'COMPLETED_VOID_FIRST_CANONICAL_CLOSE_OVERLAP_PASS');
 }else if(voidFirst){
  const lines=written.out.trim().split('\n');
  assert.equal(JSON.parse(lines[0]).status,'success');
  assert.equal(JSON.parse(result.out.trim()).ok,true,'Floor after void must succeed using restored stack');
  const restored=JSON.parse(lines.at(-1)),after=JSON.parse(projectionSnapshot());
  for(const key of ['hand','entries','counts'])assert.deepEqual(after[key],restored[key],`Floor move must preserve void-restored ${key}`);
  assert.equal(sql("SELECT count(*) FROM public.tournament_seats WHERE entry_id='85700000-0000-4000-8000-000000000001' AND is_active AND seat_number=3 AND chip_count=30000;"),'1');
  console.log('COMPLETED_VOID_FIRST_CANONICAL_FLOOR_MOVE_OVERLAP_PASS');
 }else if(duplicateVoid){
  const lines=written.out.trim().split('\n');
  assert.equal(JSON.parse(lines[0]).status,'success');
  assert.equal(JSON.parse(result.out.trim()).error,'Hand already voided');
  assert.equal(projectionSnapshot(),lines.at(-1),'second caller must not alter first committed restoration');
  assert.equal(sql("SELECT count(*) FROM public.tournament_entries WHERE id IN ('85700000-0000-4000-8000-000000000001','85700000-0000-4000-8000-000000000002') AND current_stack=30000;"),'2');
  console.log('COMPLETED_VOID_DUPLICATE_OVERLAP_PASS');
 }else{
 assert.match(result.out,moveSeat?/void_seat_dependency/:closeSession?/void_session_mismatch/:/void_stack_dependency/,'void must revalidate committed dependency, not report success');
 if(floorMove){
  const lines=written.out.trim().split('\n');
  assert.equal(JSON.parse(lines[0]).ok,true,'canonical Floor move must actually succeed');
  assert.equal(projectionSnapshot(),lines.at(-1),'void denial must preserve canonical Floor committed state');
 }else assert.equal(projectionSnapshot(),before,'committed denial must not mutate hand or chip projections beyond the writer delta');
 if(!closeSession&&!moveSeat)assert.equal(Number(sql("SELECT current_stack FROM public.tournament_entries WHERE id='85700000-0000-4000-8000-000000000001';")),initialStack+1000);
 console.log(floorMove?'COMPLETED_VOID_CANONICAL_FLOOR_MOVE_OVERLAP_PASS':moveSeat?'COMPLETED_VOID_SEAT_MOVE_OVERLAP_PASS':closeSession?'COMPLETED_VOID_SESSION_CLOSE_OVERLAP_PASS':'COMPLETED_VOID_STACK_OVERLAP_PASS');
 }
}finally{writer?.end('ROLLBACK;');voider?.end('ROLLBACK;');await Promise.all([writer?.result,voider?.result]);}
