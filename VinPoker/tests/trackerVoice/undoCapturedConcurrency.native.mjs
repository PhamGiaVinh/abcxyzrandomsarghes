// Real concurrent sessions against the captured Undo writer. A fresh clone of
// the explicitly owned fixture is required; no hosted Auth/HTTP claim is made.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

assert.equal(process.platform,'win32');
const sourceDatabase='vinpoker_hud_test_current_undo_20261107a';
const database=process.env.UNDO_CONCURRENCY_DATABASE;
assert.match(database??'',/^vinpoker_hud_test_undo_race_20261107[a-z0-9]{1,8}$/);
const reportPath=process.env.UNDO_CONCURRENCY_REPORT;
assert.match(reportPath??'',/^D:\/Quy-trinh-hud-scale-evidence\/undo-concurrency-[a-z0-9-]+\.json$/);
assert.equal(existsSync(reportPath),false,'new immutable report required before allocating a clone');
const contenders=Number(process.env.UNDO_CONCURRENCY_CONTENDERS??20);
assert.ok([2,20].includes(contenders));
const lockFix=process.env.UNDO_CONCURRENCY_LOCK_FIX==='1';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-p','55441','-U','postgres','-d',db];
const query=(text,db=database)=>{
 const r=spawnSync('wsl',args(db),{input:text,encoding:'utf8',timeout:30000,maxBuffer:1048576,windowsHide:true});
 if(r.status!==0){
  const diagnostic={kind:'UNDO_CONCURRENCY_PREPARATION_FAILED',passed:false,exitCode:r.status,
   sqlState:r.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]??null,
   blockLine:Number(r.stderr?.match(/inline_code_block line (\d+)/)?.[1]??0),
   assertionFailed:/assertion failed/.test(r.stderr??''),permissionDenied:/permission denied/.test(r.stderr??''),
   diagnosticSha256:createHash('sha256').update(r.stderr??'').digest('hex'),productionChanged:false};
  writeFileSync(reportPath,JSON.stringify(diagnostic,null,2)+'\n',{flag:'wx',mode:0o600});
  throw Error('Owned clone SQL failed; sanitized diagnostic saved');
 }
 return r.stdout.trim();
};
const bodyHash=body=>createHash('md5').update(body.replaceAll('\r','')).digest('hex');
assert.equal(query("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();",sourceDatabase),'vinpoker-owned-current-undo-20261107a');
assert.equal(query(`SELECT count(*) FROM pg_database WHERE datname='${database}';`,'postgres'),'0','fresh owned clone required');
query(`CREATE DATABASE ${database} TEMPLATE ${sourceDatabase};`,'postgres');
query(`COMMENT ON DATABASE ${database} IS 'vinpoker-owned-undo-concurrency-20261107';`,'postgres');
assert.equal(query("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
assert.equal(query("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.delete_last_action(uuid,uuid)'::regprocedure;"),'af19be0f327568eafedac42e4c7671d8');
const contextHash=()=>query("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public._tracker_correction_uat_context(uuid,uuid,uuid,text)'::regprocedure;");
assert.equal(contextHash(),'2e3c0d73bce278f80a8983d3a425f206');
if(lockFix){
 query(readFileSync(new URL('../../supabase/migrations/20261107045330_tracker_correction_hand_lock_order_v1.sql',import.meta.url),'utf8'));
 assert.equal(contextHash(),'6fbc46ed8c9b7712a4546480a07385ae');
}
const source=readFileSync(new URL('../../supabase/migrations/20270115000016_tracker_correction_uat_release2.sql',import.meta.url),'utf8').replaceAll('\r','');
const definition=source.match(/CREATE OR REPLACE FUNCTION public\.undo_tracker_last_action_v1\([\s\S]*?AS (\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/);
assert.ok(definition);assert.equal(bodyHash(definition[2]),'60291b40aab10a1deccbe2aae1195215');
// Reuse only the canonical check-in/assignment/start/action preparation from
// the existing fixture. Its old Undo/receipt/cancellation assertions never run.
let fixture=readFileSync(new URL('./undo681.authorized-current.rollback.sql',import.meta.url),'utf8').replaceAll('\r','');
const seam=" PERFORM set_config('role','authenticated',true);\n receipt:=public.undo_tracker_last_action_v1";
assert.equal(fixture.split(seam).length,2);
fixture=fixture.slice(0,fixture.indexOf(seam));
assert.equal(fixture.split("ASSERT current_database()='vinpoker_ops_cash115_qualified_c';").length,2);
fixture=fixture.replace("ASSERT current_database()='vinpoker_ops_cash115_qualified_c';",`ASSERT current_database()='${database}';`);
fixture=fixture.replace('BEGIN;\nSET LOCAL lock_timeout',()=>`BEGIN;\n${definition[0]}\nCREATE TEMP TABLE undo_race_context(value jsonb);\nSET LOCAL lock_timeout`);
assert.ok(fixture.includes(definition[0]),'captured function dollar quoting must remain byte-identical');
fixture+=`INSERT INTO pg_temp.undo_race_context VALUES(jsonb_build_object('actor',actor,'tour',tour,'table',tbl,'hand',hand,'action',act,'revision',rev,'key',key,'sb',sb));END $$;COMMIT;SELECT value FROM pg_temp.undo_race_context;`;
const context=JSON.parse(query(fixture));
const claims=`SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${context.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({role:'authenticated',sub:context.actor})}';`;
const invoke=(key,action=context.action,revision=context.revision)=>`SELECT public.undo_tracker_last_action_v1('${context.tour}','${context.table}','${context.hand}','${action}',${revision},'${key}');`;
const rows=()=>JSON.parse(query(`SELECT json_build_object('actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id='${context.hand}'),'receipts',(SELECT count(*) FROM public.tracker_correction_operations WHERE actor_user_id='${context.actor}'),'chips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_table_id='${context.table}' AND is_active),'revision',(SELECT source_revision FROM public.tournament_hands WHERE id='${context.hand}'));`));
const session=(text,application)=>new Promise((resolve,reject)=>{
 const p=spawn('wsl',args(database),{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 const timer=setTimeout(()=>{p.kill();reject(Error('Concurrent native session exceeded deadline'));},20000);
 p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('error',reject);
 p.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Object.assign(Error('Concurrent native session failed'),{diagnostic:{sqlState:String(err).match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]??null,
  functions:[...new Set([...String(err).matchAll(/PL\/pgSQL function ([a-z_][a-z0-9_]*)\(/g)].map(m=>m[1]))].slice(0,10),
  relations:[...new Set([...String(err).matchAll(/relation "([a-z_]+)"/g)].map(m=>m[1]).filter(n=>['tournament_hands','tournament_tables','table_sessions','hand_actions','hand_players','tracker_correction_operations','audit_logs'].includes(n)))],
  locks:[...new Set([...String(err).matchAll(/\b(ShareLock|ExclusiveLock|RowShareLock|RowExclusiveLock|ShareRowExclusiveLock|AccessShareLock|AccessExclusiveLock)\b/g)].map(m=>m[1]))],
 }}));else resolve(JSON.parse(out.trim()));});
 p.stdin.end(`BEGIN;SET LOCAL application_name='${application}';SET LOCAL statement_timeout='15s';${claims}${text}COMMIT;`);
});
async function race(keys,action,revision,label){
 const application='undo-race-'+label;
 const blocker=spawn('wsl',args(database),{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let lockOutput='';const held=new Promise((resolve,reject)=>{
  blocker.stdout.on('data',c=>{lockOutput+=c;if(lockOutput.includes('UNDO_RACE_LOCK_HELD'))resolve();});
  blocker.on('error',reject);blocker.on('close',()=>reject(Error('Blocker exited before release')));
 });
 let blockerError='';blocker.stderr.on('data',c=>blockerError+=c);
 const closed=new Promise((resolve,reject)=>blocker.on('close',code=>code===0?resolve():reject(Error('Blocker failed'))));
 blocker.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SELECT id FROM public.tournament_hands WHERE id='${context.hand}' FOR UPDATE;\n\\echo UNDO_RACE_LOCK_HELD\n`);
 const lockDeadline=setTimeout(()=>blocker.kill(),18000);
 const pending=[];
 try{
  await held;
  for(const key of keys)pending.push(session(invoke(key,action,revision),application).then(answer=>({answer}),error=>({error:error.diagnostic??{sqlState:null}})));
  // Require every contender to be live and blocked on an actual PostgreSQL
  // lock before releasing the hand. Connection startup is not latency evidence.
  const end=Date.now()+10000;let waiting=0;
  while(Date.now()<end){
   waiting=Number(query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${application}' AND state='active' AND wait_event_type='Lock';`));
   if(waiting===keys.length)break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(waiting,keys.length,'all contenders must overlap while lock-blocked');
  blocker.stdin.end('COMMIT;\n');await closed;
  const results=await Promise.all(pending);
  return {answers:results.filter(r=>r.answer).map(r=>r.answer),errors:results.filter(r=>r.error).map(r=>r.error),overlappingSessions:waiting};
 }finally{
  clearTimeout(lockDeadline);if(!blocker.stdin.destroyed)blocker.stdin.end('ROLLBACK;\n');
  await Promise.allSettled(pending);
 }
}
const initial=rows();assert.equal(initial.actions,3);assert.equal(initial.chips,60000);assert.equal(initial.receipts,0);
const same=await race(Array(contenders).fill(context.key),context.action,context.revision,'same');
if(same.errors.length){
 writeFileSync(reportPath,JSON.stringify({kind:'CAPTURED_UNDO_REAL_POSTGRES_CONCURRENCY',passed:false,bodyMd5:bodyHash(definition[2]),contextBodyMd5:contextHash(),lockFix,case:'same-key',contenders,overlappingSessions:same.overlappingSessions,errors:same.errors,successfulMutations:same.answers.filter(a=>a.ok&&a.duplicate===false).length,sourceState:rows(),productionChanged:false,qualification:false},null,2)+'\n',{flag:'wx',mode:0o600});
 throw Error('Same-key concurrency failed; sanitized receipt saved');
}
assert.equal(same.answers.filter(a=>a.ok&&a.duplicate===false).length,1);
for(const a of same.answers)assert.ok(a.ok||['last_action_changed','stale_source_revision'].includes(a.error));
const afterSame=rows();assert.equal(afterSame.actions,2);assert.equal(afterSame.receipts,1);assert.equal(afterSame.chips,initial.chips);
const retries=await Promise.all(Array.from({length:contenders},()=>session(invoke(context.key),'undo-race-retry')));
const winner=same.answers.find(a=>a.ok&&a.duplicate===false);
for(const a of retries)assert.deepEqual(a,{...winner,duplicate:true});
const next=JSON.parse(query(`BEGIN;${claims}SELECT public.record_action('${context.hand}','${context.sb}','fold',3,1,'preflop',0,'race:${randomUUID()}',NULL,'${context.actor}');COMMIT;`));
assert.equal(next.status,'success');
const secondRevision=rows().revision;
const distinct=await race(Array.from({length:contenders},()=>randomUUID()),next.action_id,secondRevision,'distinct');
assert.deepEqual(distinct.errors,[]);
assert.equal(distinct.answers.filter(a=>a.ok).length,1);
for(const a of distinct.answers)assert.ok(a.ok||['last_action_changed','stale_source_revision'].includes(a.error));
const final=rows();assert.equal(final.actions,2);assert.equal(final.receipts,2);assert.equal(final.chips,60000);
if(lockFix){
 query(readFileSync(new URL('../../scripts/ops/tracker-correction-hand-lock-20261107-rollback.sql',import.meta.url),'utf8'));
 assert.equal(contextHash(),'2e3c0d73bce278f80a8983d3a425f206');assert.deepEqual(rows(),final);
}
const report={kind:'CAPTURED_UNDO_REAL_POSTGRES_CONCURRENCY',passed:true,bodyMd5:bodyHash(definition[2]),lockFix,cases:[{kind:'same-key',contenders,overlappingSessions:same.overlappingSessions,successfulMutations:1,retries:contenders},{kind:'distinct-keys-same-action',contenders,overlappingSessions:distinct.overlappingSessions,successfulMutations:1}],chipsConserved:true,actionsDeleted:2,receipts:2,lockFixRecoveryVerified:lockFix,productionChanged:false,qualification:false,limitations:'Native database roles and canonical synthetic preparation on fresh owned clone. Row-lock barrier deliberately introduces delay;not latency,AuthHTTP,receipt-reader,cancellation,full-catalog or production capacity evidence. Clone retained for inspection.'};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
