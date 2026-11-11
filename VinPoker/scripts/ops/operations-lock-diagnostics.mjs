// Read-only, disposable-fixture observer. Never export SQL text or parameters.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const tags=new Set(['cashier','hud','spectator','other']);
export function sanitizeLockSample(row){
 assert.ok(row&&Array.isArray(row.waits));
 assert.ok(Number.isFinite(Date.parse(row.at)));
 return {at:row.at,waits:row.waits.map(w=>{
  assert.ok(Number.isSafeInteger(w.pid)&&w.pid>0&&tags.has(w.tag));
  assert.equal(w.waitType,'Lock');assert.ok(typeof w.waitEvent==='string'&&/^[A-Za-z_]{1,50}$/.test(w.waitEvent));
  assert.ok(Number.isFinite(w.xactAgeMs)&&w.xactAgeMs>=0&&Array.isArray(w.blockers));
  return {pid:w.pid,tag:w.tag,waitType:w.waitType,waitEvent:w.waitEvent,xactAgeMs:w.xactAgeMs,
   blockers:w.blockers.map(b=>{assert.ok(Number.isSafeInteger(b.pid)&&b.pid>0&&tags.has(b.tag));return {pid:b.pid,tag:b.tag};})};})};
}
const tag=q=>`CASE WHEN ${q} LIKE '%resolve_cashier_cash_buyin_intent_v1%' THEN 'cashier' WHEN ${q} LIKE '%public_hud%' THEN 'hud' WHEN ${q} LIKE '%public_spectator%' THEN 'spectator' ELSE 'other' END`;
const sampleSql=`WITH waits AS (SELECT a.pid,a.wait_event_type,a.wait_event,a.xact_start,${tag('a.query')} tag,pg_blocking_pids(a.pid) blockers FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND a.query LIKE '%resolve_cashier_cash_buyin_intent_v1%')
SELECT jsonb_build_object('at',clock_timestamp(),'waits',coalesce((SELECT jsonb_agg(jsonb_build_object('pid',w.pid,'tag',w.tag,'waitType',w.wait_event_type,'waitEvent',w.wait_event,'xactAgeMs',greatest(0,extract(epoch FROM(clock_timestamp()-w.xact_start))*1000),'blockers',coalesce((SELECT jsonb_agg(jsonb_build_object('pid',b.pid,'tag',${tag('b.query')})) FROM pg_stat_activity b WHERE b.pid=ANY(w.blockers)),'[]'::jsonb))) FROM waits w),'[]'::jsonb));`;

async function main(){
 const [container,file,sha]=process.argv.slice(2);
 assert.match(container??'',/^supabase_db_cashier-e2e-[A-Za-z0-9_-]+$/);
 assert.match(sha??'',/^[a-f0-9]{40}$/);assert.ok(file?.endsWith('-http.json'));
 const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
 let stderrBytes=0,stopping=false;child.stderr.on('data',b=>stderrBytes+=b.length);
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 async function sql(query){child.stdin.write(query+'\n');let timer;try{const line=await Promise.race([lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OBSERVER_READ_DEADLINE')),2000);})]);assert.equal(line.done,false);return JSON.parse(line.value);}finally{clearTimeout(timer);}}
 const started=Date.now(),durations=[];
 const report={kind:'READ_ONLY_ORIGINAL_PAYMENT_LOCK_SAMPLES',sha,phase:'starting',samplePeriodMs:50,samples:0,waitSamples:0,waits:[],qualification:false,productionChanged:false,limitations:'Disposable10-viewer diagnosis only;extra PostgreSQL observer overhead. Captures original cashier RPC waits,not SQLSTATE or causal proof of a caught exception. No raw queries/parameters/context. A missing sample does not prove absence of contention.'};
 const save=()=>writeFileSync(file,JSON.stringify({...report,elapsedMs:Date.now()-started,observerQueryMaxMs:Math.max(0,...durations),stderrBytes},null,2));
 process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
 try{
  child.stdin.write("SET application_name='ops_readonly_payment_lock_observer';SET default_transaction_read_only=on;SET statement_timeout='500ms';\n");
  const guard=await sql("SELECT jsonb_build_object('owned',current_user='postgres' AND current_database()='postgres' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='vinpoker-operational-schema-fence-disposable','frozen',EXISTS(SELECT 1 FROM ops_load_fixture_v1.schema_fence WHERE singleton AND frozen AND admission_at IS NOT NULL));");
  assert.equal(guard.owned,true);assert.equal(guard.frozen,true);report.phase='ready';save();
  while(!stopping){
   assert.ok(Date.now()-started<180000,'OBSERVER_SCOPE_DEADLINE');
   const at=Date.now(),sample=sanitizeLockSample(await sql(sampleSql));durations.push(Date.now()-at);report.samples++;
   if(sample.waits.length){report.waitSamples++;if(report.waits.length<1000)report.waits.push(sample);}
   if(report.samples%20===0||sample.waits.length)save();
   await new Promise(resolve=>setTimeout(resolve,Math.max(1,50-(Date.now()-at))));
  }
  report.phase='stopped';
 }catch{report.phase='failed';process.exitCode=1;}
 finally{child.stdin.end();let timer;const result=await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);clearTimeout(timer);if(!result||result.code!==0){report.phase='failed';process.exitCode=1;}save();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
