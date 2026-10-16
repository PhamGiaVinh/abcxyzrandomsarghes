import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['vinpoker_ops_initial102_ci','vinpoker_ops_initial102_qualified'].includes(process.env.PGDATABASE));for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
function sql(input,ok=true,expectedError){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);else {assert.notEqual(r.status,0);if(expectedError)assert.ok(r.stderr.includes(expectedError),r.stderr);}return r.stdout.trim();}
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
const signature='public.resolve_dealer_initial_assignment_intent_v1(uuid,uuid,uuid,uuid,uuid,uuid)';
const dependencies=`SELECT pg_get_functiondef('public.worker_assign_dealer_to_session_v1(uuid,uuid,uuid,uuid,timestamptz,text)'::regprocedure)||pg_get_functiondef('public.worker_read_initial_assignment_receipt_v1(text,uuid,uuid,uuid,uuid)'::regprocedure);`;
const before=sql(dependencies),migration=readFileSync('supabase/migrations/20270128000102_dealer_initial_intent_resolution_v1.sql','utf8');
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL`),'t');sql(migration.replace(/COMMIT;\s*$/,"DO $$ BEGIN RAISE EXCEPTION 'injected_initial102_ddl_failure';END $$;COMMIT;"),false,'injected_initial102_ddl_failure');
assert.equal(sql(`SELECT to_regprocedure('${signature}') IS NULL`),'t');assert.equal(sql(dependencies),before);sql(migration);assert.equal(sql(dependencies),before);
const actor='e1800000-0000-4000-8000-000000000001',club='e1800000-0000-4000-8000-000000000002',shift='e1800000-0000-4000-8000-000000000030';
const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';SET ROLE service_role;`;
const contexts=Array.from({length:4},()=>({table:randomUUID(),session:randomUUID(),dealer:randomUUID(),attendance:randomUUID(),request:randomUUID()}));
sql(contexts.map((c,n)=>`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES('${c.table}','${club}','Initial102 TEST ${n}',11+${n},'cash','inactive','available');
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,control_mode,control_epoch,revision,opened_by) VALUES('${c.session}','${club}','${c.table}','cash','manual',1,1,'${actor}');
INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${c.dealer}','${club}','Initial102 TEST ${n}','active');
INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state) VALUES('${c.attendance}','${c.dealer}','${shift}',current_date,'checked_in',now(),'available');`).join('\n'));
const key=c=>`open_manual_${actor}_${c.request}`;
const write=c=>`SELECT public.worker_assign_dealer_to_session_v1('${club}','${c.table}','${c.session}','${c.attendance}',now()+interval '45 minutes','${key(c)}');`;
const resolve=(c,a=actor,cl=club)=>`SELECT public.resolve_dealer_initial_assignment_intent_v1('${a}','${cl}','${c.table}','${c.session}','${c.dealer}','${c.request}');`;
const parse=v=>JSON.parse(v.split('\n').find(line=>line.startsWith('{')));
const state=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),'receipts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_key) FROM floor_private.dealer_initial_assign_receipts a),'sessions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.table_sessions a))::text);`);
function tx(name,query,hold=false){const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';const result=new Promise(resolve=>{child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>error+=v);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});const end=cmd=>{if(!child.stdin.writableEnded)child.stdin.end(cmd+';\n');};child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='10s';${query}\n`);if(!hold)end('COMMIT');return {result,end};}
async function barrier(name,condition){for(let n=0;n<120;n++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition})`)==='t')return;await new Promise(r=>setTimeout(r,20));}assert.fail('missing overlap '+name);}
for(const [n,order] of ['writer-first','resolver-first'].entries()){
 const c=contexts[n];let holder,waiter;
 try{
  holder=tx('initial102_holder',service+(order==='writer-first'?write(c):resolve(c)),true);await barrier('initial102_holder',"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx('initial102_waiter',service+(order==='writer-first'?resolve(c):write(c)));await barrier('initial102_waiter',"wait_event_type='Lock'");
  holder.end('COMMIT');const first=await holder.result,last=await waiter.result;assert.equal(first.code,0,first.error);assert.equal(last.code,0,last.error);
  assert.equal(parse(order==='writer-first'?first.out:last.out).outcome,'ok');
  assert.equal(parse(order==='writer-first'?last.out:first.out).status,order==='writer-first'?'receipt_found':'receipt_not_found');
  const fingerprint=state();const recovered=parse(sql(service+resolve(c)));assert.equal(recovered.status,'receipt_found');assert.equal(recovered.receipt.outcome,'ok');assert.equal(state(),fingerprint);
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
// Fixture close transition, not a canonical Floor-close E2E claim.
const c=contexts[2];let closer,resolver,lateWriter;
try{
 closer=tx('initial102_close',`SELECT id FROM public.game_tables WHERE id='${c.table}' FOR UPDATE;UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id='${c.session}';`,true);
 await barrier('initial102_close',"wait_event='ClientRead' AND xact_start IS NOT NULL");resolver=tx('initial102_resolve',service+resolve(c));await barrier('initial102_resolve',"wait_event_type='Lock'");
 lateWriter=tx('initial102_late',service+write(c));await barrier('initial102_late',"wait_event_type='Lock'");closer.end('COMMIT');
 const a=await closer.result,b=await resolver.result,d=await lateWriter.result;assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);assert.equal(d.code,0,d.error);
 assert.equal(parse(b.out).status,'intent_obsolete');assert.equal(parse(d.out).outcome,'table_session_changed');
 assert.equal(sql(`SELECT count(*) FROM floor_private.dealer_initial_assign_receipts WHERE request_key='${key(c)}'`),'0');
}finally{closer?.end('ROLLBACK');resolver?.end('ROLLBACK');lateWriter?.end('ROLLBACK');await Promise.all([closer?.result,resolver?.result,lateWriter?.result]);}
// Successful receipt takes priority even after later closure of its session.
const prior=contexts[0];sql(`UPDATE public.dealer_assignments SET status='completed',released_at=clock_timestamp() WHERE table_session_id='${prior.session}' AND released_at IS NULL;UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id='${prior.session}';`);
assert.equal(parse(sql(service+resolve(prior))).status,'receipt_found');
// Explicit synthetic legacy commit without a full receipt remains attention.
const legacy=contexts[3];sql(`${service}RESET ROLE;INSERT INTO public.dealer_assignments(attendance_id,dealer_id,club_id,table_id,table_session_id,status,idempotency_key) VALUES('${legacy.attendance}','${legacy.dealer}','${club}','${legacy.table}','${legacy.session}','assigned','${key(legacy)}');UPDATE public.dealer_assignments SET status='completed',released_at=clock_timestamp() WHERE table_session_id='${legacy.session}';UPDATE public.table_sessions SET closed_at=clock_timestamp() WHERE id='${legacy.session}';`);
const fingerprint=state();assert.equal(parse(sql(service+resolve(legacy))).status,'legacy_receipt_review_required');
for(const args of [[contexts[2],'e1800000-0000-4000-8000-000000000099',club],[contexts[2],actor,'e1800000-0000-4000-8000-000000000099']])sql(service+resolve(...args),false,'SWING_OPERATOR_FORBIDDEN');
for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_function_privilege('${role}','${signature}','EXECUTE')`),'f');
assert.equal(sql(`SELECT has_function_privilege('service_role','${signature}','EXECUTE')`),'t');
assert.equal(sql(`SELECT prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig @> ARRAY['search_path=""','lock_timeout=3s'] FROM pg_proc WHERE oid='${signature}'::regprocedure;`),'t');
assert.equal(state(),fingerprint);assert.equal(sql(dependencies),before);
console.log('INITIAL102_DDL_ROLLBACK_WRITER_RESOLVER_CLOSE_OVERLAP_RECEIPT_PRIORITY_LEGACY_ZERO_WRITE_PASS');
