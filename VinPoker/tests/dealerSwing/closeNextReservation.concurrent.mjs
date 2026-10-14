import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_close79_overlap');
for(const key of ['PGHOSTADDR','PGSERVICE','PGOPTIONS']) assert.ok(!process.env[key],key);
function sql(query) {
 const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr); return r.stdout.trim();
}
assert.equal(sql('SHOW server_version_num;').slice(0,2),'17');
const fixture=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8');
const marker='-- Canonical close with an announced replacement';
assert.equal(fixture.split(marker).length,2,'exact seed boundary');
// Commit only synthetic fixture in this specifically named disposable clone.
sql(fixture.split(marker)[0]+'\nCOMMIT;');
sql(`SET request.jwt.claim.role='service_role'; SET request.headers='{}';
 INSERT INTO public.dealers(id,club_id,full_name,status) VALUES
 ('e1800000-0000-4000-8000-000000000034','e1800000-0000-4000-8000-000000000002','Concurrent replacement TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES
 ('e1800000-0000-4000-8000-000000000044','e1800000-0000-4000-8000-000000000034',
 'e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');`);
const actor=`SET ROLE authenticated; SET request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001'; SET request.jwt.claim.role='authenticated';`;
function transaction(name,query,hold=false) {
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']); let out='',error='';
 const done=new Promise(resolve=>{
  child.stdout.on('data',part=>out+=part); child.stderr.on('data',part=>error+=part);
  child.on('error',e=>resolve({code:-1,error:String(e),out}));
  child.on('close',code=>resolve({code,error,out}));
 });
 child.stdin.write(`SET application_name='${name}'; SET statement_timeout='15s'; ${actor} BEGIN; ${query}\n`);
 if(!hold) child.stdin.end('COMMIT;\n');
 return {done,commit:()=>child.stdin.end('COMMIT;\n')};
}
async function barrier(name,condition) {
 for(let i=0;i<200;i++) {
  if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND application_name='${name}' AND ${condition});`)==='t') return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.fail(`true-overlap barrier missing: ${name}`);
}
const change=transaction('close79_plan_holder',`SELECT public.set_rotation_slot_dealer(
 'e1800000-0000-4000-8000-000000000070',2,'e1800000-0000-4000-8000-000000000044','overlap TEST');`,true);
await barrier('close79_plan_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
const revision=sql("SELECT revision FROM public.table_sessions WHERE id='e1800000-0000-4000-8000-000000000023';");
const close=transaction('close79_canonical_waiter',`SELECT public.operator_close_club_table_v2(
 'e1800000-0000-4000-8000-000000000023',${revision},'e1800000-0000-4000-8000-000000000084');`);
await barrier('close79_canonical_waiter',"wait_event_type='Lock'");
change.commit(); const changed=await change.done; assert.equal(changed.code,0,changed.error); assert.match(changed.out,/"outcome": "changed"/);
const closed=await close.done; assert.equal(closed.code,0,closed.error); assert.match(closed.out,/"closed": true/);
assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE id IN
 ('e1800000-0000-4000-8000-000000000043','e1800000-0000-4000-8000-000000000044')
 AND current_state='available' AND pre_assigned_table_id IS NULL;`),'2');
assert.equal(sql("SELECT status FROM public.dealer_rotation_schedule WHERE id='e1800000-0000-4000-8000-000000000070';"),'cancelled');
assert.equal(sql("SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='e1800000-0000-4000-8000-000000000023' AND released_at IS NULL;"),'0');
console.log('CLOSE79_TRUE_OVERLAP_NEXT_CHANGE_THEN_CLOSE_PASS');
// Reverse order on the other canonical fixture session: close commits while
// holding the schedule, then the late changer must observe cancelled, not revive it.
sql(`INSERT INTO public.dealer_rotation_schedule(id,club_id,table_id,assignment_id,slot_index,planned_relief_at,plan_run_id,solver_version)
 SELECT 'e1800000-0000-4000-8000-000000000075',club_id,table_id,id,0,now(),
 'e1800000-0000-4000-8000-000000000071','reverse overlap TEST'
 FROM public.dealer_assignments WHERE table_id='e1800000-0000-4000-8000-000000000011' AND released_at IS NULL;`);
assert.match(sql(`${actor} SELECT public.set_rotation_slot_dealer('e1800000-0000-4000-8000-000000000075',1,
 'e1800000-0000-4000-8000-000000000043','reverse overlap TEST');`),/"outcome": "changed"/);
const tuple=JSON.parse(sql(`SELECT json_build_object('id',id,'revision',revision) FROM public.table_sessions
 WHERE game_table_id='e1800000-0000-4000-8000-000000000011' AND closed_at IS NULL;`));
const closeFirst=transaction('close79_close_holder',`SELECT public.operator_close_club_table_v2(
 '${tuple.id}',${tuple.revision},'e1800000-0000-4000-8000-000000000085');`,true);
await barrier('close79_close_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
const lateChange=transaction('close79_late_change',`SELECT public.set_rotation_slot_dealer(
 'e1800000-0000-4000-8000-000000000075',2,'e1800000-0000-4000-8000-000000000044','late TEST');`);
await barrier('close79_late_change',"wait_event_type='Lock'");
closeFirst.commit(); const first=await closeFirst.done; assert.equal(first.code,0,first.error); assert.match(first.out,/"closed": true/);
const late=await lateChange.done; assert.equal(late.code,0,late.error); assert.match(late.out,/"outcome": "race_lost"/);
assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE id IN
 ('e1800000-0000-4000-8000-000000000043','e1800000-0000-4000-8000-000000000044')
 AND current_state='available' AND pre_assigned_table_id IS NULL;`),'2');
assert.equal(sql("SELECT status FROM public.dealer_rotation_schedule WHERE id='e1800000-0000-4000-8000-000000000075';"),'cancelled');
console.log('CLOSE79_TRUE_OVERLAP_CLOSE_THEN_LATE_CHANGE_PASS');
