import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

assert.equal(process.env.VINPOKER_FEATURE821_ROLLBACK,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
 'PGDATABASE=vinpoker_checkout814_race_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
 'vinpoker_checkout814_race_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),
 'VINPOKER_CHECKOUT814_OWNED_LOCAL_CLONE_SOURCE_vinpoker_fnb719_gate_local_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
const tables=['dealer_table_profiles','dealer_table_pool_members','audit_logs','dealers','dealer_attendance',
 'dealer_assignments','dealer_payroll','payroll_periods','game_tables','table_sessions','tournament_tables',
 'tournaments','cashier_buyin_movements','club_settings','centerpoint_tournament_ops_release','clubs','club_dealer_controls','user_roles'];
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
const before=fingerprint();
const definitions=()=>sql("SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(pg_get_functiondef(oid)),proacl::text) ORDER BY oid) FROM pg_proc WHERE oid IN('public.set_table_dealer_mode(uuid,text,boolean,boolean)'::regprocedure,'public.set_table_dealer_pool(uuid,jsonb)'::regprocedure);");
const old=definitions();
let candidate=readFileSync(new URL('../../supabase/migrations/20270128000290_dealer_feature_config_atomic_v1.sql',import.meta.url),'utf8');
const sourceHash=createHash('sha256').update(candidate).digest('hex');
assert.equal(candidate.split('\nBEGIN;').length,2);
assert.match(candidate,/COMMIT;\s*$/);
candidate=candidate.replace('\nBEGIN;','\n').replace(/COMMIT;\s*$/,'');
if(process.argv.includes('--concurrent822')) {
 await concurrent822();
} else if(process.argv.includes('--actor-cancel824')) {
 actorCancel824();
} else if(process.argv.includes('--cancel-overlap825')) {
 await cancelOverlap825();
} else try {
 const baseline=sql("SELECT to_regprocedure('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)') IS NULL;");
 assert.equal(baseline,'t','candidate must remain absent outside the rollback test');
 console.log('FEATURE821_BASELINE_MISSING_CANONICAL_ATOMIC_RPC_RED');
 console.log(sql('BEGIN;\n'+candidate+'\n'+readFileSync(new URL('./feature821.atomic.rollback.sql',import.meta.url),'utf8')+'\nROLLBACK;'));
} finally {
 assert.equal(fingerprint(),before,'protected business/configuration changed');
 assert.equal(definitions(),old,'legacy definitions or grants changed after rollback');
 assert.equal(sql("SELECT to_regclass('private.dealer_feature_config_receipts_v1') IS NULL AND to_regprocedure('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)') IS NULL;"),'t');
 console.log('FEATURE821_FULL_ROLLBACK_BUSINESS_FUNCTION_ACL_UNCHANGED');
}

async function cancelOverlap825(){
 assert.equal(process.env.VINPOKER_FEATURE825_COMMIT,'1','explicit owned-clone291 install and TEST98 commit required');
 let forward=readFileSync(new URL('../../supabase/migrations/20270128000291_dealer_feature_profile_actor_cancel_v2.sql',import.meta.url),'utf8');
 const hash=createHash('sha256').update(forward).digest('hex');
 assert.equal(hash,'3ed72d6e9f3d332e762ce09dd843e2b033bfdafc25d3937e6d469b39edbe7c0c');
 assert.equal(sql("SELECT to_regclass('private.feature825_install') IS NULL;"),'t','825 preparation consumed; use readonly postcheck');
 const club='d4427834-5f5f-48ef-bde5-e2dc388ed00b',actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
 const physical=sql(`SELECT id FROM public.game_tables WHERE club_id='${club}' AND table_number=98;`);assert.match(physical,/^[a-f0-9-]{36}$/);
 assert.equal(sql(`SELECT count(*) FROM public.dealer_table_profiles WHERE table_id='${physical}';`),'0');
 const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${['dealer_table_profiles','dealer_table_pool_members'].includes(t)?` WHERE table_id<>'${physical}'`:t==='audit_logs'?` WHERE entity_id::text IS DISTINCT FROM '${physical}'`:''})`).join(',')},(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.dealer_feature_config_receipts_v1 x WHERE table_id<>'${physical}'))::text);`);
 const protectedBefore=protectedFacts();
 assert.equal(forward.split('\nBEGIN;').length,2);assert.match(forward,/COMMIT;\s*$/);forward=forward.replace('\nBEGIN;','\n').replace(/COMMIT;\s*$/,'');
 sql(`BEGIN;CREATE TEMP TABLE feature825_old AS SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'owner',pg_get_userbyid(proowner),'acl',proacl::text)) saved FROM pg_proc WHERE oid IN('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)'::regprocedure,'public.get_table_dealer_profile_receipt_v1(uuid,uuid)'::regprocedure);
 ${forward}
 CREATE TABLE private.feature825_install(id boolean PRIMARY KEY DEFAULT true CHECK(id),source_hash text NOT NULL,old_catalog jsonb NOT NULL,proof jsonb);
 ALTER TABLE private.feature825_install ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.feature825_install FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO private.feature825_install(source_hash,old_catalog) SELECT '${hash}',saved FROM feature825_old;COMMIT;`);
 assert.equal(fingerprint(),before,'291 installation changed business rows');
 const workers=[];let seq=0;
 const worker=()=>{
  const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.on('data',s=>out+=String(s));child.stderr.on('data',s=>err+=String(s));
  const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(err)));});void closed.catch(()=>{});
  const query=async command=>{const tag=`FEATURE825_${++seq}`;child.stdin.write(`\\echo ${tag}_START\n${command};\n\\echo ${tag}_END\n`);
   const deadline=Date.now()+12000;while(!out.includes(tag+'_END')){assert.equal(child.exitCode,null,err);assert.ok(Date.now()<deadline,err||'native observation deadline');await delay(20);}
   const result=out.split(tag+'_START')[1].split(tag+'_END')[0].trim();return result?JSON.parse(result):null;};
  const value={child,closed,query};workers.push(value);return value;
 };
 const begin=name=>`BEGIN;SET LOCAL application_name='feature825_${name}';SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='25s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const command=(kind,key)=>`SELECT public.${kind}_table_dealer_profile_v2('${club}','${physical}','normal',false,false,'[]'::jsonb,'${key}','${actor}')`;
 const proof={source_hash:hash,physical,protected_fingerprint:protectedBefore,orders:[]};
 try{
  for(const first of ['cancel','save']){
   const key=randomUUID(),holder=worker(),waiter=worker();
   const a=await holder.query(begin('holder')+command(first,key));assert.equal(a.status,first==='cancel'?'cancelled':'saved');
   const pending=waiter.query(begin('waiter')+command(first==='cancel'?'save':'cancel',key));void pending.catch(()=>{});
   let seen=false;const deadline=Date.now()+7000;
   while(Date.now()<deadline){seen=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='feature825_waiter' AND a.application_name='feature825_holder' AND b.wait_event_type='Lock');")==='t';if(seen)break;await delay(40);}
   assert.ok(seen,'actual cancel/save advisory barrier not observed');
   await holder.query('COMMIT;SELECT to_jsonb(1)');const b=await pending;assert.deepEqual(b,a);await waiter.query('COMMIT;SELECT to_jsonb(1)');
   proof.orders.push({first,request_id:key,actual_lock:true,holder:a,waiter:b});
   if(first==='cancel')assert.equal(sql(`SELECT count(*) FROM public.dealer_table_profiles WHERE table_id='${physical}';`),'0','late save revived cancelled intent');
  }
  assert.equal(sql(`SELECT count(*) FROM private.dealer_feature_config_receipts_v1 WHERE table_id='${physical}';`),'2');
  assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id::text='${physical}';`),'3');
 }finally{
  for(const w of workers)if(w.child.exitCode===null)w.child.stdin.end('ROLLBACK;\n');
  await Promise.allSettled(workers.map(w=>w.closed));assert.equal(protectedFacts(),protectedBefore,'825 changed unrelated configuration/business or old receipts');
 }
 const encoded=JSON.stringify(proof).replaceAll("'","''");
 sql(`BEGIN;UPDATE private.feature825_install SET proof='${encoded}'::jsonb WHERE id AND proof IS NULL;COMMIT;`);
 console.log('FEATURE825_CANCEL_SAVE_TWO_ACTUAL_COMMIT_ORDER_LOCK_PROOFS',JSON.stringify(proof));
}

function actorCancel824(){
 let forward=readFileSync(new URL('../../supabase/migrations/20270128000291_dealer_feature_profile_actor_cancel_v2.sql',import.meta.url),'utf8');
 assert.equal(forward.split('\nBEGIN;').length,2);assert.match(forward,/COMMIT;\s*$/);
 forward=forward.replace('\nBEGIN;','\n').replace(/COMMIT;\s*$/,'');
 const snapshot=()=>sql("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM private.dealer_feature_config_receipts_v1 x),(SELECT jsonb_agg(jsonb_build_array(oid::regprocedure::text,pg_get_functiondef(oid),proacl::text) ORDER BY oid) FROM pg_proc WHERE oid IN('public.save_table_dealer_profile_v1(uuid,uuid,text,boolean,boolean,jsonb,uuid)'::regprocedure,'public.get_table_dealer_profile_receipt_v1(uuid,uuid)'::regprocedure)));");
 const saved=snapshot();
 assert.equal(sql("SELECT to_regprocedure('public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)') IS NULL;"),'t');
 console.log('FEATURE824_BASELINE_EXPECTED_ACTOR_CANCEL_CONTRACT_ABSENT_RED');
 try{console.log(sql('BEGIN;\n'+forward+'\n'+readFileSync(new URL('./feature824.actor-cancel.rollback.sql',import.meta.url),'utf8')+'\nROLLBACK;'));}
 finally{
  assert.equal(fingerprint(),before);assert.equal(snapshot(),saved);assert.equal(definitions(),old);
  assert.equal(sql("SELECT to_regprocedure('public.save_table_dealer_profile_v2(uuid,uuid,text,boolean,boolean,jsonb,uuid,uuid)') IS NULL;"),'t');
  console.log('FEATURE824_FULL_ROLLBACK_ORIGINAL_RECEIPTS_FUNCTION_ACL_BUSINESS_PRESERVED');
 }
}

async function concurrent822(){
 assert.equal(process.env.VINPOKER_FEATURE822_COMMIT,'1','explicit owned-clone install/canary commit required');
 assert.equal(sourceHash,'23ca3bdb00d2e0d098401d1e6eba153f67de0c2ea822fa07708f97a96c305dc8','reviewed candidate drift');
 const physical='e532db28-8841-48b0-8972-a9355f1dabe3',club='d4427834-5f5f-48ef-bde5-e2dc388ed00b';
 const actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',outsider='675fe35e-60a8-4452-bb90-e79486d54da6';
 const quote=v=>`'${String(v).replaceAll("'","''")}'`;
 const auth=id=>`RESET ROLE;SET LOCAL request.jwt.claim.sub='${id}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${id}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
 const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x${['dealer_table_profiles','dealer_table_pool_members'].includes(t)?` WHERE table_id<>'${physical}'`:t==='audit_logs'?` WHERE entity_id::text IS DISTINCT FROM '${physical}'`:''})`).join(',')})::text);`);
 const protectedBefore=protectedFacts();
 // Consume one owned installation/canary, never reset it to manufacture another green.
 assert.equal(sql("SELECT to_regclass('private.feature822_install') IS NULL;"),'t','822 already started; inspect metadata/postchecks, do not recreate');
 assert.equal(sql(`SELECT count(*) FROM public.dealer_table_profiles WHERE table_id='${physical}';`),'0');
 sql(`BEGIN;CREATE TEMP TABLE feature822_old AS SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'owner',pg_get_userbyid(proowner),'definition',pg_get_functiondef(oid),'acl',proacl::text)) saved FROM pg_proc WHERE oid IN('public.set_table_dealer_mode(uuid,text,boolean,boolean)'::regprocedure,'public.set_table_dealer_pool(uuid,jsonb)'::regprocedure);
 ${candidate}
 CREATE TABLE private.feature822_install(id boolean PRIMARY KEY DEFAULT true CHECK(id),source_hash text NOT NULL,old_catalog jsonb NOT NULL,proof jsonb);
 ALTER TABLE private.feature822_install ENABLE ROW LEVEL SECURITY;REVOKE ALL ON private.feature822_install FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO private.feature822_install(source_hash,old_catalog) SELECT '${sourceHash}',saved FROM feature822_old;
 COMMIT;`);
 assert.equal(fingerprint(),before,'installation changed business rows');
 const members=sql(`SELECT jsonb_agg(jsonb_build_object('dealer_id',id,'priority',priority,'is_primary',priority=0) ORDER BY priority) FROM(SELECT id,(row_number()OVER(ORDER BY id)-1)::integer priority FROM public.dealers WHERE club_id='${club}' ORDER BY id LIMIT 2)d;`);
 assert.equal(JSON.parse(members).length,2);
 const save=(key,mode='feature')=>`SELECT public.save_table_dealer_profile_v1('${club}','${physical}','${mode}',false,false,${quote(members)}::jsonb,'${key}')`;
 const workers=[];
 function worker(name){
  const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',seq=0;
  child.stdout.on('data',s=>out+=String(s));child.stderr.on('data',s=>err+=String(s));
  const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(err)));});void closed.catch(()=>{});
  const query=async command=>{
   const tag=`FEATURE822_${name}_${++seq}`;child.stdin.write(`\\echo ${tag}_START\n${command};\n\\echo ${tag}_END\n`);
   const deadline=Date.now()+12000;
   while(!out.includes(tag+'_END')){assert.equal(child.exitCode,null,err);assert.ok(Date.now()<deadline,err||'native observation deadline');await delay(20);}
   const result=out.split(tag+'_START')[1].split(tag+'_END')[0].trim();return result?JSON.parse(result):null;
  };
  const value={child,closed,query};workers.push(value);return value;
 }
 const holder=worker('holder');
 const barrier=async()=>{
  const deadline=Date.now()+7000;let seen=false;
  while(Date.now()<deadline){
   seen=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='feature822_waiter' AND a.application_name='feature822_holder' AND b.wait_event_type='Lock');")==='t';
   if(seen)break;await delay(40);
  }
  assert.ok(seen,'actual native lock barrier not observed');return seen;
 };
 const begin=(name,id=actor)=>`BEGIN;SET LOCAL application_name='feature822_${name}';SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='25s';${auth(id)}`;
 const proof={source_hash:sourceHash,orders:[]};let createdGrant=false;
 try{
  // True COMMIT/replay overlap: waiter sees the winner's durable receipt, not a mock.
  const key=randomUUID(),waiter=worker('same');
  await holder.query(begin('holder')+'SELECT to_jsonb(1)');
  const first=await holder.query(save(key));assert.equal(first.status,'saved');
  const pending=waiter.query(begin('waiter')+save(key));void pending.catch(()=>{});
  await barrier();await holder.query('COMMIT;SELECT to_jsonb(1)');
  const second=await pending;assert.deepEqual(second,first);
  await waiter.query('COMMIT;SELECT to_jsonb(1)');
  assert.equal(sql(`SELECT count(*) FROM private.dealer_feature_config_receipts_v1 WHERE actor_id='${actor}' AND request_id='${key}';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id::text='${physical}';`),'2');
  proof.request_id=key;proof.result=first;proof.orders.push({name:'same_key_commit_replay',actual_lock:true,receipt_count:1,audit_count:2});
  const committed=fingerprint();
  // Hold a replay's request lock. Different payload must wait, then conflict.
  const conflict=worker('conflict');
  await holder.query(begin('holder')+save(key));
  const fail=conflict.query(begin('waiter')+`DO $$BEGIN BEGIN PERFORM public.save_table_dealer_profile_v1('${club}','${physical}','normal',false,false,${quote(members)}::jsonb,'${key}');RAISE EXCEPTION 'expected conflict';EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='DEALER_PROFILE_REQUEST_CONFLICT';END;END $$;SELECT to_jsonb('conflict'::text)`);void fail.catch(()=>{});
  await barrier();
  await holder.query('COMMIT;SELECT to_jsonb(1)');
  assert.equal(await fail,'conflict');
  await conflict.query('ROLLBACK;SELECT to_jsonb(1)');
  assert.equal(fingerprint(),committed);
  proof.orders.push({name:'same_key_changed_payload_conflict',actual_lock:true,business_delta:false});
  // Independent request keys still serialize at the physical table anchor.
  const other=worker('table'),nextKey=randomUUID();
  await holder.query(begin('holder')+save(randomUUID(),'normal'));
  const tableWait=other.query(begin('waiter')+save(nextKey));void tableWait.catch(()=>{});
  await barrier();await holder.query('ROLLBACK;SELECT to_jsonb(1)');
  assert.equal((await tableWait).status,'saved');
  await other.query('ROLLBACK;SELECT to_jsonb(1)');assert.equal(fingerprint(),committed);
  proof.orders.push({name:'different_keys_same_table',actual_lock:true,both_business_rolled_back:true});
  // Add only a new explicit TEST grant, never alter club ownership or old grants.
  assert.equal(sql(`SELECT public._dealer_feature_can_manage('${outsider}','${club}');`),'f');
  assert.equal(sql(`SELECT count(*) FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${outsider}';`),'0');
  sql(`BEGIN;INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES('${club}','${outsider}');COMMIT;`);
  createdGrant=true;
  const withGrant=fingerprint();
  const revoke=worker('revoke'),deniedKey=randomUUID();
  // Pending revocation waits for a writer that already holds current authority.
  await holder.query(begin('holder',outsider)+save(randomUUID(),'normal'));
  const deletion=revoke.query(`BEGIN;SET LOCAL application_name='feature822_waiter';SET LOCAL statement_timeout='15s';WITH d AS(DELETE FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${outsider}' RETURNING 1) SELECT to_jsonb(count(*)) FROM d`);void deletion.catch(()=>{});
  await barrier();await holder.query('ROLLBACK;SELECT to_jsonb(1)');
  assert.equal(await deletion,1);await revoke.query('ROLLBACK;SELECT to_jsonb(1)');assert.equal(fingerprint(),withGrant);
  proof.orders.push({name:'save_before_revoke',actual_lock:true,both_business_rolled_back:true});
  // A committed revocation defeats a writer queued behind the authority lock.
  await holder.query(`BEGIN;SET LOCAL application_name='feature822_holder';SET LOCAL statement_timeout='15s';WITH d AS(DELETE FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${outsider}' RETURNING 1) SELECT to_jsonb(count(*)) FROM d`);
  const unauthorized=worker('unauthorized');
  const denied=unauthorized.query(begin('waiter',outsider)+`DO $$BEGIN BEGIN PERFORM public.save_table_dealer_profile_v1('${club}','${physical}','normal',false,false,${quote(members)}::jsonb,'${deniedKey}');RAISE EXCEPTION 'expected revoked authority denial';EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='DEALER_PROFILE_FORBIDDEN';END;END $$;SELECT to_jsonb('denied'::text)`);void denied.catch(()=>{});
  await barrier();await holder.query('COMMIT;SELECT to_jsonb(1)');
  assert.equal(await denied,'denied');await unauthorized.query('ROLLBACK;SELECT to_jsonb(1)');
  createdGrant=false;
  assert.equal(fingerprint(),committed);
  proof.orders.push({name:'revoke_before_save',actual_lock:true,revocation_committed:true,write_denied:true});
 } finally {
  for(const w of workers){if(w.child.exitCode===null)w.child.stdin.end('ROLLBACK;\n');}
  await Promise.allSettled(workers.map(w=>w.closed));
  if(createdGrant)sql(`BEGIN;DELETE FROM public.club_dealer_controls WHERE club_id='${club}' AND user_id='${outsider}';COMMIT;`);
  assert.equal(protectedFacts(),protectedBefore,'unrelated business rows changed');
 }
 sql(`BEGIN;UPDATE private.feature822_install SET proof=${quote(JSON.stringify(proof))}::jsonb WHERE id AND proof IS NULL;COMMIT;`);
 console.log('FEATURE822_COMMITTED_NATIVE_LOCK_PROOFS',JSON.stringify(proof));
}
