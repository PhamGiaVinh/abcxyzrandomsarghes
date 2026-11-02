import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_OVERLAY218_CONCURRENCY,'1');
const source='vinpoker_ops_cash115_qualified_c',scratch='vinpoker_overlay218_disposable';
const marker='VINPOKER_OVERLAY218_DISPOSABLE_LOCAL_SIMULATED_PROVIDER';
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d',account='TEST-OVERLAY218-NOT-REAL';
const query=(db,input)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1',
 'PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:20000,maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const sql=input=>query(scratch,input);
const fingerprint=()=>query(source,`SELECT md5(jsonb_build_object(
 'bank',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.bank_transactions r),
 'accounts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.platform_bank_accounts r),
 'overlay',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.multi_day_overlay_funding_v1 r),
 'body',(SELECT prosrc FROM pg_proc WHERE oid='public.multi_day_record_overlay_v1(uuid,text,bigint,text,text,uuid,uuid,uuid,uuid)'::regprocedure),
 'gate',(SELECT jsonb_agg(to_jsonb(r)) FROM public.multi_day_package_release_v1 r))::text);`);
assert.equal(query(source,'SHOW data_directory;'),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(query(source,"SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(query(source,`SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}';`),'0',
 'pre-funding qualification only; retained finalized journey must not be reused or reset');
assert.ok(Number(query(source,'SELECT pg_database_size(current_database());'))<256*1024*1024);
assert.equal(query('postgres',`SELECT count(*) FROM pg_database WHERE datname='${scratch}';`),'0');
const before=fingerprint(),sessions=[];let created=false;
const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
function session(name){
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
  'PGUSER=postgres',`PGDATABASE=${scratch}`,`PGAPPNAME=${name}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
  {stdio:['pipe','pipe','pipe'],timeout:20000});
 let output='',errors='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{errors+=x;});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,output,errors}));});
 void closed.catch(()=>{});const handle={child,closed,output:()=>output};sessions.push(handle);return handle;
}
async function until(check){const end=Date.now()+10000;while(!check()){
 assert.ok(Date.now()<end,'actual PostgreSQL concurrency barrier timeout');await new Promise(r=>setTimeout(r,20));}}
try{
 query('postgres',`CREATE DATABASE ${scratch} TEMPLATE ${source};`);created=true;
 query('postgres',`COMMENT ON DATABASE ${scratch} IS '${marker}';`);
 sql(readFileSync(new URL('../../supabase/migrations/20270128000218_multiday_overlay_verified_bank_scope_v1.sql',import.meta.url),'utf8'));
 sql(`GRANT USAGE ON SCHEMA auth TO authenticated;
  UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;
  INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,notes)
  VALUES('${club}','SIMULATED LOCAL BANK','${account}','NO REAL ACCOUNT','${marker}');
  SET ROLE service_role;
  SELECT public.sepay_ingest_verified_transactions('[{"provider_txn_id":"LOCAL_218_SIMULATED_NOT_REAL",
   "account_number":"${account}","amount":900000,"transfer_type":"in","content":"LOCAL TEST GTD",
   "occurred_at":"2026-10-21T00:00:00+07:00","raw_payload":{"localSimulation":true,"externalTransfer":false}}]');`);
 const bank=sql(`SELECT id FROM public.bank_transactions WHERE account_number='${account}';`);
 assert.match(bank,/^[a-f0-9-]{36}$/);
 const call=key=>`SELECT public.multi_day_record_overlay_v1('${event}','RECORDED',900000,
  'LOCAL_218_SIMULATED_NOT_REAL','LOCAL clone TEST, provider simulated, no external transfer',NULL,NULL,'${key}','${bank}');`;
 const firstKey='9a6da19a-ed4f-4237-a681-18fa60875218';
 // First prove a concurrent mapping INSERT cannot become a phantom while the
 // real overlay function owns the account-map SHARE lock. Both transactions roll back.
 const mapA=session('overlay218_map_a'),mapB=session('overlay218_map_b');
 mapA.child.stdin.write(`BEGIN;${auth}${call(firstKey)} SELECT 'MAP_A_READY';\n`);
 await until(()=>mapA.output().includes('MAP_A_READY'));
 mapB.child.stdin.end(`BEGIN;INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder)
  VALUES('12ac8914-4a94-4f29-99d6-a74a506c134e','SIMULATED','${account}','NO REAL ACCOUNT');ROLLBACK;\n`);
 await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
  WHERE a.application_name='overlay218_map_b' AND NOT l.granted AND l.relation='public.platform_bank_accounts'::regclass);`)==='t');
 mapA.child.stdin.end('ROLLBACK;\n');
 assert.equal((await mapA.closed).code,0);assert.equal((await mapB.closed).code,0);
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE event_id='${event}';`),'0');
 assert.equal(sql(`SELECT club_id IS NULL FROM public.bank_transactions WHERE id='${bank}';`),'t');
 console.log('OVERLAY218_REAL_ACCOUNT_MAP_PHANTOM_LOCK_AND_ROLLBACK_PASS');
 // Competing different keys for one bank: second waits for the actual bank
 // row lock, then must see the matched row and fail, not allocate it twice.
 const a=session('overlay218_bank_a'),b=session('overlay218_bank_b');
 a.child.stdin.write(`BEGIN;${auth}${call(firstKey)} SELECT 'BANK_A_READY';\n`);
 await until(()=>a.output().includes('BANK_A_READY'));
 b.child.stdin.end(`BEGIN;${auth}${call('fe117a90-a837-4b89-b213-a445e2465218')}COMMIT;\n`);
 await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='overlay218_bank_b'
  AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);`)==='t');
 a.child.stdin.end('COMMIT;\n');assert.equal((await a.closed).code,0);
 const denied=await b.closed;assert.notEqual(denied.code,0);
 assert.match(denied.errors,/multi_day_overlay_bank_unverified_or_allocated/);
 const replay=JSON.parse(sql(`BEGIN;${auth}${call(firstKey)}COMMIT;`));
 assert.equal(replay.idempotent,true);
 assert.equal(sql(`SELECT count(*)||'|'||sum(amount_vnd) FROM public.multi_day_overlay_funding_v1 WHERE event_id='${event}';`),'1|900000');
 console.log('OVERLAY218_REAL_BANK_LOCK_SINGLE_ALLOCATION_DIFFERENT_KEY_DENIAL_REPLAY_PASS');
 sql(readFileSync(new URL('./multiDayOverlayIngest.recovery.pg17.sql',import.meta.url),'utf8'));
 assert.equal(sql(`SELECT count(*)||'|'||sum(amount_vnd) FROM public.multi_day_overlay_funding_v1 WHERE event_id='${event}';`),'1|900000');
 assert.equal(sql(`SELECT status||'|'||club_id FROM public.bank_transactions WHERE id='${bank}';`),'matched|'+club);
 console.log('OVERLAY218_EXACT_FUNCTION_RECOVERY_PRESERVES_AUDITED_FUNDING_PASS');
}finally{
 for(const handle of sessions)if(!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled(sessions.map(x=>x.closed));
 if(created){
  assert.equal(query('postgres',`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${scratch}';`),marker);
  assert.notEqual(scratch,source);query('postgres',`DROP DATABASE ${scratch};`);
 }
 assert.equal(fingerprint(),before,'source bank/account/overlay/function/gate changed');
 console.log('OVERLAY218_CLONE_REMOVED_SOURCE_PRESERVED_PASS');
}
