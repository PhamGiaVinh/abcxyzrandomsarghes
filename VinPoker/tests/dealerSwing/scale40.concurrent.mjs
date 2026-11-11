import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_scale40_overlap');
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k],k);
function sql(query){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql('SHOW server_version_num;').slice(0,2),'17');
const fixture=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8'),marker='DO '+String.fromCharCode(36)+'scale'+String.fromCharCode(36);
assert.equal(fixture.split(marker).length,2,'seed ends before sequential worker assignments');
sql(fixture.split(marker)[0]+'\nRESET ROLE;COMMIT;');
const club='e1800000-0000-4000-8000-000000000002';
const tuples=JSON.parse(sql(`SELECT json_agg(json_build_object('n',n,'table',g.id,'session',s.id,
 'attendance',md5('scale40-attendance-'||n)::uuid,'dealer',md5('scale40-dealer-'||n)::uuid) ORDER BY n)
 FROM generate_series(1,40) n JOIN public.game_tables g ON g.id=md5('scale40-table-'||n)::uuid
 JOIN public.table_sessions s ON s.game_table_id=g.id AND s.closed_at IS NULL;`));
assert.equal(tuples.length,40);
const worker="SET ROLE service_role;SET request.jwt.claim.role='service_role';SET request.headers='{}';";
function transaction(name,query,hold=false){
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const done=new Promise(resolve=>{child.stdout.on('data',p=>out+=p);child.stderr.on('data',p=>error+=p);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 child.stdin.write(`SET application_name='${name}';SET statement_timeout='25s';BEGIN;${query}\n`);
 if(!hold)child.stdin.end('COMMIT;\n');return {done,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(query){for(let n=0;n<300;n++){if(sql(query)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('40-worker simultaneous lock barrier missing');}
const holder=transaction('scale40_physical_holder',`SELECT g.id FROM public.game_tables g
 WHERE g.id IN(SELECT md5('scale40-table-'||n)::uuid FROM generate_series(1,40)n) ORDER BY g.id FOR UPDATE;`,true);
await barrier("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='scale40_physical_holder' AND wait_event='ClientRead' AND xact_start IS NOT NULL);");
const started=Date.now();
const requests=tuples.map(t=>transaction(`scale40_worker_${t.n}`,`${worker} SELECT public.worker_assign_dealer_to_session_v1(
 '${club}','${t.table}','${t.session}','${t.attendance}',now()+interval '45 minutes','scale40-overlap-${t.n}');`));
try{
 await barrier("SELECT count(*)=40 FROM pg_stat_activity WHERE application_name ~ '^scale40_worker_[0-9]+$' AND wait_event_type='Lock';");
}finally{holder.commit();}
assert.equal((await holder.done).code,0);
for(const result of await Promise.all(requests.map(r=>r.done))){assert.equal(result.code,0,result.error);const data=JSON.parse(result.out.split('\n').find(l=>l.startsWith('{')));assert.equal(data.outcome,'ok',JSON.stringify(data));}
const counts=JSON.parse(sql(`SELECT json_build_object('assignments',count(*),'attendances',count(DISTINCT a.attendance_id),
 'sessions',count(DISTINCT a.table_session_id)) FROM public.dealer_assignments a
 WHERE a.table_id IN(SELECT md5('scale40-table-'||n)::uuid FROM generate_series(1,40)n) AND a.released_at IS NULL;`));
assert.deepEqual(counts,{assignments:40,attendances:40,sessions:40});
// Unknown-response recovery reads the stored receipts instead of making new writes.
for(const t of tuples){const data=JSON.parse(sql(`${worker} SELECT public.worker_read_initial_assignment_receipt_v1(
 'scale40-overlap-${t.n}','${club}','${t.table}','${t.session}','${t.dealer}');`));assert.equal(data.outcome,'ok');}
assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_id IN
 (SELECT md5('scale40-table-'||n)::uuid FROM generate_series(1,40)n) AND released_at IS NULL;`),'40');
console.log(JSON.stringify({proof:'SCALE40_REAL_CONCURRENT_CANONICAL_ASSIGNMENT_RECEIPTS_PASS',blockedSimultaneously:40,...counts,elapsedMs:Date.now()-started}));
