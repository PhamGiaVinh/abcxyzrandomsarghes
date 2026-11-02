import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {parsePrizeConfigurationSaveReceipt} from '../../src/ops/floor/multiDayPrizeConfigurationIntent.ts';

const source='vinpoker_ops_cash115_qualified_c',scratch='vinpoker_config217_concurrency_20261021';
const marker='VINPOKER_LOCAL_CONFIG217_CONCURRENCY_DISPOSABLE_20261021';
const args=db=>['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const query=(db,input)=>execFileSync('wsl',args(db),{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
const sql=input=>query(scratch,input);
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d',final='4cd3af4d-7e1d-4042-855f-04fb6777e580';
const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const auth=statement=>JSON.parse(sql(`BEGIN;${claims}${statement}ROLLBACK;`));
const rows=first=>[{position:1,amount:first},...Array.from({length:3},(_,i)=>({position:i+2,amount:110000}))];
const preview=values=>auth(`SELECT public.multi_day_payout_configuration_preview_v1('${event}',${quote(JSON.stringify(values))}::jsonb);`);
const save=(p,values,key)=>`SELECT public.multi_day_save_prize_configuration_v1('${event}',${quote(JSON.stringify(values))}::jsonb,
 ${quote(p.configurationRevision)},${quote(p.rulesVersion)},${quote(p.fundingRevision)},${quote(p.qualificationRevision)},
 ${quote(p.payoutInputHash)},'${key}','TEST isolated concurrency only');`;
const sourceFingerprint=()=>query(source,`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m),
 'prizes',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tournament_prizes m),
 'payments',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tournament_prize_payments m),
 'gates',(SELECT jsonb_agg(to_jsonb(m)) FROM public.multi_day_package_release_v1 m),
 'guard',(SELECT prosrc FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure))::text);`);
assert.equal(query(source,'SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.ok(Number(query(source,'SELECT pg_database_size(current_database());'))<256*1024*1024,'clone size exceeds the explicit lightweight test bound');
assert.equal(query('postgres',`SELECT count(*) FROM pg_database WHERE datname='${scratch}';`),'0','do not reuse or delete a pre-existing database');
assert.equal(query(source,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0','external workers must be absent');
const before=sourceFingerprint();let created=false;const evidence=[];
const sessions=[];
function session(name){
 const child=spawn('wsl',args(scratch),{stdio:['pipe','pipe','pipe']});let out='',err='',exit;
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{exit=code;resolve(code);});});
 const value={child,done,get out(){return out;},get err(){return err;},get exit(){return exit;},
  send:text=>child.stdin.write(text+'\n'),end:text=>child.stdin.end((text??'')+'\n')};
 sessions.push(value);
 value.send(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='${name}';${claims}`);
 return value;
}
async function until(predicate,message){
 const until=Date.now()+12000;
 while(Date.now()<until){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,40));}
 throw new Error(message);
}
function packet(s){return JSON.parse(s.out.trim().split(/\r?\n/).find(line=>line.startsWith('{'))??'null');}
async function overlap(values,keyA,keyB,kind,valuesB=values){
 const p=preview(values),pB=kind==='conflict'?preview(valuesB):p,tag=`config217_${kind}_${process.pid}`;
 const a=session(tag+'_A'),b=session(tag+'_B');
 a.send(save(p,values,keyA));
 await until(()=>a.out.includes('"CONFIGURED"')||a.exit!==undefined,'writer A did not reach its held transaction');
 assert.equal(a.exit,undefined,a.err);assert.equal(packet(a).state,'CONFIGURED');
 if(kind==='finalize'){
  // Finalize reviews the currently stored table, not A's uncommitted proposal.
  const old=auth(`SELECT public.multi_day_payout_preview_v1('${event}');`);
  b.end(`SELECT public.multi_day_finalize_payout_v1('${event}',${quote(old.rulesVersion)},${quote(old.fundingRevision)},${quote(old.qualificationRevision)},${quote(old.payoutInputHash)},'${keyB}');COMMIT;`);
 }else b.end(save(pB,valuesB,keyB)+'COMMIT;');
 await until(()=>sql(`SELECT coalesce(bool_or(wait_event_type='Lock'),false) FROM pg_stat_activity WHERE application_name='${tag}_B';`)==='t'||b.exit!==undefined,'writer B did not overlap A');
 assert.equal(b.exit,undefined,'B finished without waiting: '+b.err);
 const blocked=JSON.parse(sql(`SELECT jsonb_build_object('pid',pid,'wait',wait_event,'blockingPids',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE application_name='${tag}_B';`));
 const pidA=Number(sql(`SELECT pid FROM pg_stat_activity WHERE application_name='${tag}_A';`));
 const wait=blocked.wait;assert.ok(wait);assert.ok(blocked.blockingPids.includes(pidA),'B was not waiting on A');a.end('COMMIT;');
 assert.equal(await a.done,0,a.err);
 const exitB=await b.done;
 const expectedArgs={p_event_id:event,p_rows:values,p_expected_configuration_revision:p.configurationRevision,
  p_expected_rules_version:p.rulesVersion,p_expected_funding_revision:p.fundingRevision,
  p_expected_qualification_revision:p.qualificationRevision,p_expected_payout_input_hash:p.payoutInputHash,
  p_request_id:keyA,p_reason:'TEST isolated concurrency only'};
 parsePrizeConfigurationSaveReceipt(packet(a),expectedArgs);
 assert.throws(()=>parsePrizeConfigurationSaveReceipt(packet(a),{...expectedArgs,p_reason:'Changed retained intent'}),/unverified/);
 assert.doesNotMatch(b.err,/deadlock|lock timeout|statement timeout/i);
 if(kind==='replay'){
  assert.equal(exitB,0,b.err);assert.equal(packet(b).idempotent,true);
  parsePrizeConfigurationSaveReceipt(packet(b),expectedArgs);
  assert.equal(packet(b).configurationRevision,packet(a).configurationRevision);
 }else{
  assert.equal(exitB,3,'losing mutation unexpectedly committed');
  assert.match(b.err,kind==='stale'?/multi_day_configuration_stale/:kind==='conflict'?/multi_day_configuration_idempotency_conflict/:/multi_day_payout_(recalculate|funding|not_ready|shortfall)/);
 }
 evidence.push({kind,requestA:keyA,requestB:keyB,backendA:pidA,backendB:blocked.pid,wait,
  blockerVerified:true,receiptA:packet(a),receiptB:kind==='replay'?packet(b):null,
  rejectedMessage:kind==='replay'?null:b.err.match(/ERROR:[^\r\n]*/)?.[0]});
 console.log(`MULTIDAY200_${kind.toUpperCase()}_TWO_REAL_SESSIONS_WAIT_${wait}_PASS`);
}
try{
 query('postgres',`CREATE DATABASE ${scratch} TEMPLATE ${source};`);created=true;
 query('postgres',`COMMENT ON DATABASE ${scratch} IS '${marker}';`);
 assert.equal(sql('SELECT current_database();'),scratch);
 const candidate216=readFileSync(new URL('../../supabase/migrations/20270128000216_multiday_payout_configuration_preview_v1.sql',import.meta.url),'utf8');
 const candidate217=readFileSync(new URL('../../supabase/migrations/20270128000217_multiday_prize_configuration_atomic_v1.sql',import.meta.url),'utf8');
 sql(candidate216+candidate217);
 sql(`UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid] WHERE id;GRANT USAGE ON SCHEMA auth TO authenticated;`);
 const retryKey=randomUUID();await overlap(rows(110000),retryKey,retryKey,'replay');
 await overlap(rows(120000),randomUUID(),randomUUID(),'stale');
 const conflictKey=randomUUID();await overlap(rows(140000),conflictKey,conflictKey,'conflict',rows(150000));
 await overlap(rows(160000),randomUUID(),randomUUID(),'finalize');
 assert.equal(sql('SELECT count(*) FROM private.multi_day_prize_configurations_v1;'),'4');
 assert.equal(sql('SELECT count(*) FROM private.multi_day_prize_write_intents_v1;'),'0');
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${final}';`),'0');
 assert.equal(sourceFingerprint(),before,'original browser database changed');
 console.log('MULTIDAY200_CONCURRENT_REQUESTS_FINALIZE_NO_PAYMENT_OR_SOURCE_DB_DELTA_PASS');
 console.log('MULTIDAY200_EVIDENCE '+JSON.stringify({scratch,source,sourceFingerprint:before,
  candidate216Sha256:createHash('sha256').update(candidate216).digest('hex'),
  candidate217Sha256:createHash('sha256').update(candidate217).digest('hex'),cases:evidence}));
}finally{
 for(const s of sessions)if(s.exit===undefined&&!s.child.stdin.destroyed)s.end('ROLLBACK;');
 await Promise.all(sessions.map(s=>s.done.catch(()=>undefined)));
 if(created){
  assert.equal(query('postgres',`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${scratch}';`),marker);
  assert.notEqual(scratch,source);assert.equal(scratch,'vinpoker_config217_concurrency_20261021');
  query('postgres',`DROP DATABASE ${scratch};`);
  assert.equal(query('postgres',`SELECT count(*) FROM pg_database WHERE datname='${scratch}';`),'0');
  console.log('MULTIDAY200_OWNED_DISPOSABLE_CLONE_REMOVED_SOURCE_PRESERVED_PASS');
 }
}
