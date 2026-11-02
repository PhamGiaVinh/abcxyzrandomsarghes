import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1172_LOCAL,'1');
const attempt=process.env.VINPOKER_EARLYITM1172_ATTEMPT;
assert.match(attempt??'',/^[a-z0-9]+$/);
const globalRaces=process.env.VINPOKER_EARLYITM1172_GLOBAL_RACES==='1';
const prepareOnly=process.env.VINPOKER_EARLYITM1172_PREPARE_ONLY==='1';
const preRank=process.env.VINPOKER_EARLYITM1172_PRE_RANK==='1';
assert.ok(!prepareOnly||!globalRaces);
assert.ok(!preRank||prepareOnly);
const base='D:/Quy trình/output/reports/earlyitm'+(preRank?'1176-floor-fixture-':prepareOnly?'1174-browser-fixture-':globalRaces?'1173-global-races-':'1172-payment-concurrency-')+attempt+'-local-20261028';
assert.equal(existsSync(base+'.json'),false);
const db='vinpoker_earlyitm1172_local';
const comment='VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948';
const sourceDb='vinpoker_ranking860_local';
const sourceComment='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres'];
const args=name=>[...prefix,'PGDATABASE='+name,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const run=(name,sql)=>execFileSync('wsl',args(name),{input:sql,encoding:'utf8',timeout:60000,maxBuffer:8e6});
const guard=(name,marker)=>`DO $$ BEGIN ASSERT current_database()='${name}';ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='${marker}';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));END $$;\n`;
const jsonRows=raw=>raw.split(/\r?\n/).filter(s=>s.startsWith('{')).map(JSON.parse);
const original=readFileSync('D:/Quy trình/output/reports/earlyitm1168-liability-green3-local-20261028.sql','utf8');
const fingerprint=original.slice(original.indexOf('CREATE FUNCTION pg_temp.d2_789_fingerprint()'),original.indexOf('CREATE TEMP TABLE d2_789_protected'));
const fingerprintQuery=fingerprint.slice(fingerprint.indexOf('AS $$')+5,fingerprint.lastIndexOf('$$;')).trim().replace(/;$/,'');
assert.ok(fingerprintQuery.startsWith('SELECT md5'));
const sourceFingerprint=()=>jsonRows(run(sourceDb,'BEGIN READ ONLY;'+guard(sourceDb,sourceComment)+"SELECT jsonb_build_object('fingerprint',("+fingerprintQuery+"));ROLLBACK;"))[0].fingerprint;
const before=sourceFingerprint();
const manifest=JSON.parse(readFileSync('D:/Quy trình/output/reports/earlyitm1171-payment-manifest-local-20261028.json','utf8'));
for(const [path,hash] of Object.entries(manifest.sourceFiles))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,path+' source drift');
const candidate=readFileSync('supabase/pending-migrations/20261027172548_multiday_individual_verified_payment_v1.sql','utf8');
const schemaBegin=original.indexOf('-- LOCAL SOURCE CANDIDATE. Individual rank only:');
const fixtureBegin=original.indexOf('-- Transaction-private business qualification only, not persistent gate activation.');
const fixtureEnd=original.indexOf(' -- Run after1162 has frozen rank8. All native writes remain in outerROLLBACK.');
assert.ok(schemaBegin>0&&fixtureBegin>schemaBegin&&fixtureEnd>fixtureBegin);
const schema=original.slice(schemaBegin,fixtureBegin)+candidate;
const sessions=[];
const observations=[];
class Session {
 constructor(label){
  this.label=label;this.raw='';this.error='';this.buffer='';this.pending=null;this.closed=false;
  this.child=spawn('wsl',args(db),{stdio:['pipe','pipe','pipe']});sessions.push(this);
  this.done=new Promise(resolve=>{this.child.on('exit',(code,signal)=>{this.closed=true;if(this.pending){this.pending.reject(new Error(label+' exited '+code+' '+this.error));this.pending=null;}resolve({code,signal});});});
  this.child.stdout.on('data',chunk=>{const text=chunk.toString();this.raw+=text;this.buffer+=text;let end;
   while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).replace(/\r$/,'');this.buffer=this.buffer.slice(end+1);
    if(this.pending&&line===this.pending.marker){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(this.raw.slice(p.start));}
   }
  });
  this.child.stderr.on('data',chunk=>{this.error+=chunk.toString();});
  this.child.on('error',error=>{if(this.pending){this.pending.reject(error);this.pending=null;}});
 }
 exec(sql){assert.equal(this.closed,false);assert.equal(this.pending,null);const marker='DONE_'+randomUUID().replaceAll('-','');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(this.label+' timed out '+this.error)),25000);
   this.pending={marker,start:this.raw.length,resolve,reject,timer};this.child.stdin.write(sql+'\n\\echo '+marker+'\n');});
 }
 async begin(actor){
  const raw=await this.exec('BEGIN;'+guard(db,comment)+`SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='15s';SELECT set_config('application_name','earlyitm1172_${this.label}',true);SELECT set_config('request.jwt.claim.sub','${actor}',true);SELECT set_config('request.jwt.claim.role','authenticated',true);SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);SET LOCAL ROLE authenticated;SELECT jsonb_build_object('pid',pg_backend_pid());`);
  this.pid=jsonRows(raw).at(-1).pid;
 }
 async close(){if(!this.closed){this.child.stdin.end('ROLLBACK;\n\\q\n');}return this.done;}
}
const fixture=(caseName,completed=false)=>{
 let tail=String.raw`
 PERFORM set_config('role','none',true);
 ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_obligations_v1 WHERE event_id=event);
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
 PERFORM set_config('test.e1172.fixture',jsonb_build_object('event',event,'final',final,'actor',actor,'club',club,'participation',p,'entry',seeded_entry,'case','CASE_NAME')::text,true);
END $$;
SELECT current_setting('test.e1172.fixture')::jsonb;
COMMIT;
`.replace('CASE_NAME',()=>caseName);
 if(preRank)tail=tail.replace('count(*)=1 FROM private.multi_day_individual_obligations_v1','count(*)=0 FROM private.multi_day_individual_obligations_v1')
  .replace(' PERFORM set_config(\'test.e1172.fixture\'',()=>" ASSERT (SELECT count(*)=0 FROM private.multi_day_individual_results_v1 WHERE event_id=event);\n PERFORM set_config('test.e1172.fixture'");
 const completedEnd=original.indexOf(' DECLARE preview jsonb;result jsonb;report jsonb;item jsonb;request uuid:=gen_random_uuid();BEGIN');
 if(completed)assert.ok(completedEnd>fixtureEnd);
 const preRankEnd=original.indexOf(' state:=public.get_multi_day_individual_rank_review_v1(event);');
 if(preRank)assert.ok(preRankEnd>fixtureBegin&&preRankEnd<fixtureEnd);
 const fixtureSource=original.slice(fixtureBegin,preRank?preRankEnd:completed?completedEnd:fixtureEnd)
  .replaceAll('D2 913 Flight physical TEST ',()=>`D2 1172 ${attempt} ${caseName} Flight TEST `)
  .replaceAll('Early ITM1161 physical TEST ',()=>`Early ITM1172 ${attempt} ${caseName} physical TEST `)
  .replace('SELECT coalesce(max(table_number),0)+10 INTO table_no FROM public.game_tables WHERE club_id=club;',()=>
   'SELECT n INTO STRICT table_no FROM generate_series(0,94)n WHERE NOT EXISTS(SELECT 1 FROM public.game_tables WHERE club_id=club AND table_number BETWEEN n+1 AND n+5) ORDER BY n LIMIT 1;');
 const sql='BEGIN;'+guard(db,comment)+"SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';\n"+(completed?fingerprint:'')+fixtureSource+tail;
 writeFileSync(base+'-'+caseName+'-fixture.sql',sql);
 return jsonRows(run(db,sql)).at(-1);
};
const readContext=async(fixture,session)=>{
 const result=jsonRows(await session.exec(`SELECT public.get_tournament_payout_recipients('${fixture.final}'::uuid);`)).at(-1);
 assert.equal(result.isPartial,true);assert.equal(result.places.length,1);assert.equal(result.paidTotal,0);return result.places[0];
};
const payment=(f,token,key)=>`SELECT public.record_multi_day_prize_payment_v1('${f.event}'::uuid,'${f.participation}'::uuid,'cash','${token}','${key}'::uuid);`;
const finalize=(f,preview,key)=>{
 const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
 const call=`public.multi_day_finalize_payout_v1('${f.event}'::uuid,${['rulesVersion','fundingRevision','qualificationRevision','payoutInputHash'].map(k=>quote(preview[k])).join(',')},'${key}'::uuid)`;
 return `DO $rpc1173$ DECLARE result jsonb;BEGIN BEGIN result:=${call};EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('testCaughtError',SQLERRM,'sqlstate',SQLSTATE);END;PERFORM set_config('test.e1173.result',result::text,true);END $rpc1173$;SELECT current_setting('test.e1173.result')::jsonb;`;
};
const waitForBlock=async(blocked,blocker)=>{
 const deadline=Date.now()+10000;let evidence;
 do{
  const rows=jsonRows(run(db,'BEGIN READ ONLY;'+guard(db,comment)+`SELECT jsonb_build_object('pid',pid,'waitEventType',wait_event_type,'waitEvent',wait_event,'blockers',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid=${blocked};ROLLBACK;`));
  evidence=rows[0];if(evidence?.waitEventType==='Lock'&&evidence.blockers.includes(blocker))return evidence;
  await new Promise(resolve=>setTimeout(resolve,100));
 }while(Date.now()<deadline);
 throw new Error('Expected real database lock wait '+JSON.stringify(evidence));
};
try{
 const create=process.env.VINPOKER_EARLYITM1172_CREATE==='1';
 if(create){
  const exists=run('postgres',`DO $$ BEGIN ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='${db}');ASSERT (SELECT count(*) FROM pg_stat_activity WHERE datname='${sourceDb}')=0;END $$;CREATE DATABASE ${db} TEMPLATE ${sourceDb};COMMENT ON DATABASE ${db} IS '${comment}';`);
  writeFileSync(base+'-clone.log',exists);
  const install='BEGIN;'+guard(db,comment)+"SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';\n"+schema+'\nCOMMIT;';
  writeFileSync(base+'-install.sql',install);run(db,install);
 }else{
  const hashes=manifest.paymentFunctions.map(f=>`ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='${f.signature}'::regprocedure)='${f.md5}';`).join('\n');
  run(db,'BEGIN READ ONLY;'+guard(db,comment)+"DO $$ BEGIN ASSERT to_regclass('private.multi_day_individual_payment_commits_v1') IS NOT NULL;"+hashes+"END $$;ROLLBACK;");
 }
 if(prepareOnly)observations.push({test:preRank?'unconfirmedRankBrowserFixturePrepared':'unpaidBrowserFixturePrepared',fixture:fixture(preRank?'floorbrowser':'browser')});
 const cases=globalRaces||prepareOnly?[]:[{name:'samekeycommit',sameKey:true,commit:true},{name:'distinctkeyscommit',sameKey:false,commit:true},{name:'samekeyrollback',sameKey:true,commit:false}];
 for(const test of cases){
  const f=fixture(test.name);const a=new Session(test.name+'A'),b=new Session(test.name+'B');
  await a.begin(f.actor);await b.begin(f.actor);const context=await readContext(f,a);
  const keyA=randomUUID(),keyB=test.sameKey?keyA:randomUUID();
  const first=jsonRows(await a.exec(payment(f,context.confirmationToken,keyA))).at(-1);
  assert.equal(first.ok,true);assert.equal(first.outcome,'recorded');
  const waiting=b.exec(payment(f,context.confirmationToken,keyB));
  // Attach a handler immediately, even while we independently inspect the lock.
  let secondError;waiting.catch(error=>{secondError=error;});
  const lock=await waitForBlock(b.pid,a.pid);
  await a.exec(test.commit?'COMMIT;':'ROLLBACK;');
  const second=jsonRows(await waiting).at(-1);if(secondError)throw secondError;
  if(test.sameKey&&test.commit)assert.deepEqual(second,first);
  else if(test.commit){assert.equal(second.ok,false);assert.equal(second.error,'payout_confirmation_stale');}
  else{assert.equal(second.ok,true);assert.equal(second.outcome,'recorded');assert.notEqual(second.payment_id,first.payment_id);}
  await b.exec('COMMIT;');
  const state=jsonRows(run(db,'BEGIN READ ONLY;'+guard(db,comment)+`SELECT jsonb_build_object('payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.final}'),'paidVnd',(SELECT sum(prize_amount) FROM public.tournament_prize_payments WHERE tournament_id='${f.final}'),'proofs',(SELECT count(*) FROM private.multi_day_individual_payment_commits_v1 WHERE event_id='${f.event}'),'receipts',(SELECT count(*) FROM floor_private.payout_payment_receipts_v1 WHERE actor_id='${f.actor}' AND request_id IN('${keyA}','${keyB}')),'globalFinalizations',(SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${f.event}'));ROLLBACK;`)).at(-1);
  assert.equal(state.payments,1);assert.equal(Number(state.paidVnd),100000);assert.equal(state.proofs,1);assert.equal(state.globalFinalizations,0);assert.equal(state.receipts,test.sameKey?1:2);
  observations.push({test,fixture:f,first,second,lock,state});
  writeFileSync(base+'-partial.json',JSON.stringify({observations},null,2));
  await a.close();await b.close();
 }
 if(globalRaces)for(const firstKind of ['global','payment']){
  const f=fixture(firstKind+'first',true);const a=new Session(firstKind+'firstA'),b=new Session(firstKind+'firstB');
  await a.begin(f.actor);await b.begin(f.actor);
  const context=await readContext(f,a);
  const preview=jsonRows(await b.exec(`SELECT public.multi_day_payout_preview_v1('${f.event}'::uuid);`)).at(-1);
  assert.equal(preview.state,'READY');assert.equal(Number(preview.paidPlayerVnd),0);assert.equal(Number(preview.unpaidObligationVnd),800000);
  const first=jsonRows(await a.exec(firstKind==='global'?finalize(f,preview,randomUUID()):payment(f,context.confirmationToken,randomUUID()))).at(-1);
  assert.equal(first.ok,true);
  const waiting=b.exec(firstKind==='global'?payment(f,context.confirmationToken,randomUUID()):finalize(f,preview,randomUUID()));
  let secondError;waiting.catch(error=>{secondError=error;});
  const lock=await waitForBlock(b.pid,a.pid);await a.exec('COMMIT;');
  const second=jsonRows(await waiting).at(-1);if(secondError)throw secondError;
  if(firstKind==='global'){assert.equal(second.ok,false);assert.equal(second.error,'payout_confirmation_stale');}
  else{assert.equal(second.testCaughtError,'multi_day_payout_recalculate');assert.equal(second.sqlstate,'40001');}
  const freshPreview=jsonRows(await b.exec(`SELECT public.multi_day_payout_preview_v1('${f.event}'::uuid);`)).at(-1);
  assert.equal(Number(freshPreview.paidPlayerVnd),firstKind==='payment'?100000:0);
  assert.equal(Number(freshPreview.unpaidObligationVnd),firstKind==='payment'?700000:800000);
  await b.exec('COMMIT;');
  const state=jsonRows(run(db,'BEGIN READ ONLY;'+guard(db,comment)+`SELECT jsonb_build_object('payments',(SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.final}'),'proofs',(SELECT count(*) FROM private.multi_day_individual_payment_commits_v1 WHERE event_id='${f.event}'),'globalFinalizations',(SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${f.event}'));ROLLBACK;`)).at(-1);
  assert.equal(state.payments,firstKind==='payment'?1:0);assert.equal(state.proofs,firstKind==='payment'?1:0);assert.equal(state.globalFinalizations,firstKind==='global'?1:0);
  observations.push({test:firstKind+'first',fixture:f,first,second,lock,state,freshPreview});
  writeFileSync(base+'-partial.json',JSON.stringify({observations},null,2));await a.close();await b.close();
 }
 const after=sourceFingerprint();assert.equal(after,before,'original ranking860 source changed');
 writeFileSync(base+'.json',JSON.stringify({kind:preRank?'UNCONFIRMED_RANK_BROWSER_FIXTURE_ONLY':prepareOnly?'UNPAID_EARLY_PAYMENT_BROWSER_FIXTURE_ONLY':globalRaces?'EARLY_PAYMENT_GLOBAL_FINALIZATION_TWO_LOCK_ORDERS':'EARLY_PAYMENT_THREE_REAL_TWO_CONNECTION_LOCK_ORDERS',database:db,observations,originalSourceFingerprintBefore:before,originalSourceFingerprintAfter:after,ownedCloneRetained:true,originalJourneysAccepted:false,fullR03Accepted:false},null,2));
 console.log(preRank?'EARLYITM1176_UNCONFIRMED_RANK_FIXTURE_PREPARED_NOT_BROWSER_PASS':prepareOnly?'EARLYITM1174_UNPAID_BROWSER_FIXTURE_PREPARED_NOT_BROWSER_PASS':globalRaces?'EARLYITM1173_PAYMENT_GLOBAL_FINALIZATION_BOTH_LOCK_ORDERS_PASS_SOURCE_UNCHANGED':'EARLYITM1172_THREE_REAL_TWO_CONNECTION_PAYMENT_CASES_PASS_SOURCE_UNCHANGED');
}catch(error){writeFileSync(base+'.failure.log',String(error.stack??error));throw error;}
finally{
 for(const s of sessions){await s.close();writeFileSync(base+'-'+s.label+'-session.log',s.raw+'\nSTDERR\n'+s.error);}
}
