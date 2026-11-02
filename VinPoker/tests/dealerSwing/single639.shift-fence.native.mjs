import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_SINGLE639_SHIFT_FENCE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
const original='b4fd007d3f601a72e21717096939497b';
const commitClose=process.env.VINPOKER_SINGLE640_COMMITTED_CLOSE==='1';
const childShift='e6400000-0000-4000-8000-000000000001';
const shift=commitClose?childShift:'dc91889f-0f73-4e2c-aaf1-d539a6072aed';
const digest=()=>sql("SELECT md5(replace(pg_get_functiondef('floor_private.guard_dealer_assignment_acquisition()'::regprocedure),chr(13),''));");
assert.equal(digest(),original);
const probe=readFileSync(new URL('./single638.stale-attendance.rollback.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const facts=probe.slice(probe.indexOf('CREATE FUNCTION pg_temp.single638_facts('),probe.indexOf('SELECT pg_temp.single638_facts() AS before'));
const fingerprint=()=>sql(facts+`SELECT pg_temp.single638_facts(${commitClose?`'${childShift}'`:'NULL'});`);
const before=fingerprint();
if(commitClose){
 assert.equal(sql(`SELECT count(*) FROM public.dealer_shifts WHERE id='${childShift}';`),'0','one-shot child fixture consumed; inspect retained evidence, do not delete/reseed');
 sql(`INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time,tour_tier)
 SELECT '${childShift}',club_id,'Single640 closed-shift negative TEST ONLY',start_time,end_time,tour_tier
 FROM public.dealer_shifts WHERE id='dc91889f-0f73-4e2c-aaf1-d539a6072aed';`);
}
const candidate=readFileSync(new URL('../../supabase/migrations/20270128000272_dealer_acquisition_operating_day_v1.sql',import.meta.url),'utf8').replaceAll('\r\n','\n').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'');
const session=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']}); let out='',err='';
 child.stdout.on('data',b=>{out+=String(b);}); child.stderr.on('data',b=>{err+=String(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(`single639:${code}:${err}`)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<50;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('single639 barrier:'+label);};
const holder=session();let contender,released=false,observedWait=false;
try{
 holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL idle_in_transaction_session_timeout='30s';SET LOCAL application_name='single639-shift-close';
 UPDATE public.dealer_shifts SET closed_at=statement_timestamp() WHERE id='${shift}';
 SELECT 'SINGLE639_CLOSE_HELD';\n`);
 await until(()=>holder.output().includes('SINGLE639_CLOSE_HELD'),'close row held');
 contender=session();
 contender.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='single639-assignment';${candidate}
 SET LOCAL lock_timeout='10s';
 SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL request.jwt.claim.role='service_role';
 SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"febf2b51-fdb7-42ff-886c-b3bb1fffdc3e"}';
 UPDATE public.dealer_attendance SET shift_id='${shift}',shift_date=(statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,check_in_time=statement_timestamp() WHERE id='fefa250b-90b8-445a-8396-8c8d0317c8a0';
 DO $$ DECLARE r jsonb; BEGIN
  BEGIN
   r:=public.worker_assign_dealer_to_session_v1('d4427834-5f5f-48ef-bde5-e2dc388ed00b','991b1e8e-da4c-461a-9b39-ddebd7a5d044','b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5','fefa250b-90b8-445a-8396-8c8d0317c8a0',statement_timestamp()+interval '30 minutes','single639-rollback-only');
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'DEALER_ACQUISITION_ATTENDANCE_STALE' THEN RAISE; END IF;
   r:=jsonb_build_object('outcome','denied','error',SQLERRM);
  END;
  PERFORM set_config('single639.result',r::text,true);
 END $$;
 SELECT current_setting('single639.result');
 SELECT 'SINGLE639_ASSIGNMENT_FINISHED';ROLLBACK;\n`);
 await until(()=>{
  observedWait=sql("SELECT count(*) FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='single639-assignment' AND a.application_name='single639-shift-close' AND b.wait_event_type='Lock' AND b.wait_event IN('transactionid','tuple');")==='1';
  return observedWait||contender.output().includes('SINGLE639_ASSIGNMENT_FINISHED');
 },'actual wait or prematurely finished assignment');
 console.log('SINGLE639_OBSERVED_SHIFT_ROW_WAIT',observedWait);
 holder.child.stdin.end(commitClose?'COMMIT;\n':'ROLLBACK;\n');released=true;
 const [,out]=await Promise.all([holder.done,contender.done]);
 const result=JSON.parse(out.split(/\r?\n/).find(x=>x.startsWith('{')));
 if(commitClose){assert.equal(result.error,'DEALER_ACQUISITION_ATTENDANCE_STALE','committed close must invalidate the old snapshot');}
 else assert.equal(result.outcome,'ok','after close rollback, positive assignment should remain possible');
 assert.equal(observedWait,true,'assignment passed an uncommitted shift close without fencing it');
}finally{
 if(!released&&!holder.child.stdin.writableEnded)holder.child.stdin.end('ROLLBACK;\n');
 await holder.done.catch(()=>{}); if(contender)await contender.done.catch(()=>{});
 assert.equal(digest(),original,'candidate leaked into retained local definition');
 assert.equal(fingerprint(),before,'fourteen operational domains changed');
 if(commitClose)assert.equal(sql(`SELECT count(*) FROM public.dealer_shifts WHERE id='${childShift}' AND closed_at IS NOT NULL AND tour_name='Single640 closed-shift negative TEST ONLY';`),'1','retain only the deliberately closed child shift');
 assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction';"),'0');
 console.log('SINGLE639_ORIGINAL_DEFINITION_AND_FOURTEEN_DOMAINS_RESTORED');
}
console.log(commitClose?'SINGLE640_SHIFT_CLOSE_COMMIT_FRESH_DENIAL_PASS_CHILD_METADATA_RETAINED':'SINGLE639_SHIFT_FENCE_ROLLBACK_THEN_FRESH_POSITIVE_PASS');
