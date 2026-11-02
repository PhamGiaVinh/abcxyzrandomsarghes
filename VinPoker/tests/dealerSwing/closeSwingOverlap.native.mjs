import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {classifyManualSwingOutcome} from '../../src/lib/dealerSwingOutcome.ts';

// Real overlapping canonical operator writers; no automatic rotation/rest soak claim.
export async function runCloseSwingOverlap({sql,session,until,workerNextOnly=false,workerOverlaps=false,prepareUi=false,prepareBrowser=false}){
 const financial=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const before=financial(),base=readFileSync('tests/dealerSwing/operationalInventory.pg17.sql','utf8');
 assert.equal(base.split('ROLLBACK;').length,2);
 const anchor="SELECT set_config('request.jwt.claim.role','service_role',true);";assert.equal(base.split(anchor).length,2);
 const parse=output=>JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
 const authUsage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
 try{
 for(const order of prepareBrowser?['browser-prepare']:prepareUi?['ui-prepare']:workerOverlaps?['worker-close-first','worker-first-close']:workerNextOnly?['worker-next']:['close-first','swing-first','completion-fault']){
  const prefix=randomUUID().slice(0,8),id=n=>`${prefix}-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const actor=id(1),club=id(2),table=id(11),sid=id(21),incoming=id(44);
  const headers=`SET LOCAL request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${actor}"}';`;
  const auth=`SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';${headers}SET LOCAL ROLE authenticated;`;
  sql(base.replace('BEGIN;','BEGIN;GRANT USAGE ON SCHEMA auth TO authenticated;')
   .replace(anchor,`INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('e1700000-0000-4000-8000-000000000002',false);
    SELECT set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"e1700000-0000-4000-8000-000000000001"}',true);${anchor}`)
   .replace('ROLLBACK;','COMMIT;').replaceAll('e1700000',prefix)
   .replaceAll("'exact-key'",`'close-swing-${prefix}-exact'`).replaceAll("'cross-club-key'",`'close-swing-${prefix}-cross'`).replaceAll("'closed-key'",`'close-swing-${prefix}-closed'`));
  // Declarative TEST dealer/attendance prerequisites, not check-in acceptance.
  // Only the due deadline is injected for immediate manual handoff; rest history is not backdated.
  sql(`BEGIN;${headers}INSERT INTO public.dealers(id,club_id,full_name,status) VALUES('${id(34)}','${club}','Close Swing overlap local TEST','active');
   INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
   VALUES('${incoming}','${id(34)}','${id(30)}',current_date,'checked_in',now(),'available');
   UPDATE public.dealer_assignments SET swing_due_at=now()-interval '1 second' WHERE table_session_id='${sid}' AND released_at IS NULL;COMMIT;`);
  let assignment=JSON.parse(sql(`SELECT jsonb_build_object('id',id,'version',version) FROM public.dealer_assignments WHERE table_session_id='${sid}' AND status='assigned' AND released_at IS NULL;`));
  if(prepareBrowser)return {prefix,actor,club,table,session:sid,assignment,incoming,tour:id(3)};
  const planned=JSON.parse(sql(`BEGIN;${auth}SELECT public.operator_plan_next_dealer_v1('${sid}','${assignment.id}',${assignment.version},'${incoming}','${randomUUID()}');COMMIT;`));
  assert.equal(planned.outcome,'changed',JSON.stringify(planned));
  assignment=JSON.parse(sql(`SELECT jsonb_build_object('id',id,'version',version) FROM public.dealer_assignments WHERE id='${assignment.id}';`));
  console.log('CLOSE_SWING_CANARY_READY',JSON.stringify({order,club,session:sid,assignment:assignment.id,schedule:planned.schedule_id,auto:false}));
  if(prepareUi)return {prefix,actor,club,table,session:sid,assignment,schedule:planned.schedule_id,incoming};
  const timeFacts=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'check_in',check_in_time,'check_out',check_out_time,
   'worked',total_worked_minutes_today,'overtime',overtime_minutes) ORDER BY id) FROM public.dealer_attendance WHERE id IN('${id(41)}','${incoming}');`);
  const facts=timeFacts(),closeKey=randomUUID(),swingKey=randomUUID();
  const close=`public.operator_close_club_table_v2('${sid}',1,'${closeKey}')`;
  const swing=`public.operator_perform_swing('${table}','${sid}','${assignment.id}',${assignment.version},'${swingKey}')`;
  const workerFlow=order.startsWith('worker'),closeFirst=order==='close-first'||order==='worker-close-first';
  let swap=swing,swapAuth=auth;
  if(workerFlow){
   const slot=JSON.parse(sql(`SELECT to_jsonb(s) FROM public.dealer_rotation_schedule s WHERE id='${planned.schedule_id}';`));
   const due=sql("SELECT (now()+interval '30 minutes')::text;");
   swapAuth=`SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claim.sub='${actor}';
    SET LOCAL request.jwt.claims='{"role":"service_role","sub":"${actor}"}';${headers}SET LOCAL ROLE service_role;`;
   swap=`public.worker_execute_rotation_slot_v1('${slot.id}',${slot.version},'${sid}','${assignment.id}',${assignment.version},'${incoming}','${due}'::timestamptz,30,false,15)`;
  }
  const app=`close_swing_${prefix}`;let holder,waiter;
  try{
   if(order==='worker-next'){
    const r=JSON.parse(sql(`BEGIN;${swapAuth}SELECT ${swap};COMMIT;`));
    assert.equal(r.status,'success');assert.equal(r.rotation_completion,'executed');assert.equal(r.rotation_schedule_id,planned.schedule_id);
    assert.deepEqual(JSON.parse(sql(`BEGIN;${swapAuth}SELECT ${swap};COMMIT;`)),r,'same worker intent must replay one assignment');
    assert.equal(sql(`SELECT out_attendance_id FROM public.dealer_rotation_schedule WHERE id='${planned.schedule_id}';`),id(41));
    assert.equal(JSON.parse(sql(`BEGIN;${auth}SELECT ${close};COMMIT;`)).closed,true);
   }else if(order==='completion-fault'){
    const snapshot=()=>sql(`SELECT md5(jsonb_build_array(
     (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a WHERE table_session_id='${sid}'),
     (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a WHERE id IN('${id(41)}','${incoming}')),
     (SELECT to_jsonb(r) FROM public.dealer_rotation_schedule r WHERE id='${planned.schedule_id}'),
     (SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM public.dealer_swing_operator_requests r WHERE club_id='${club}')
    )::text);`),unmodified=snapshot(),fault=`test_manual178_${prefix}`;
    sql(`CREATE FUNCTION floor_private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
     IF NEW.id='${planned.schedule_id}'::uuid AND NEW.status='executed' THEN RAISE EXCEPTION 'LOCAL_COMPLETION_FAULT';END IF;RETURN NEW;END $$;
     CREATE TRIGGER ${fault} BEFORE UPDATE ON public.dealer_rotation_schedule FOR EACH ROW EXECUTE FUNCTION floor_private.${fault}();`);
    try{assert.throws(()=>sql(`BEGIN;${auth}SELECT ${swing};COMMIT;`),/MANUAL_SWING_PLAN_COMPLETION_FAILED/);}
    finally{sql(`DROP TRIGGER ${fault} ON public.dealer_rotation_schedule;DROP FUNCTION floor_private.${fault}();`);}
    assert.equal(snapshot(),unmodified,'failed bookkeeping must rollback swap, rest and receipt together');
    const retried=JSON.parse(sql(`BEGIN;${auth}SELECT ${swing};COMMIT;`));assert.equal(retried.outcome,'swung');assert.equal(retried.rotation_completion,'executed');
    const replay=JSON.parse(sql(`BEGIN;${auth}SELECT ${swing};COMMIT;`));assert.deepEqual(replay,{...retried,idempotent:true});
    assert.throws(()=>sql(`BEGIN;${auth}SELECT public.operator_perform_swing('${table}','${sid}','${assignment.id}',${assignment.version+1},'${swingKey}');COMMIT;`),/SWING_IDEMPOTENCY_CONFLICT/);
    assert.equal(JSON.parse(sql(`BEGIN;${auth}SELECT ${close};COMMIT;`)).closed,true);
   }else{
   holder=session(app+'_holder');holder.child.stdin.write(`BEGIN;${closeFirst?auth:swapAuth}SELECT 'RESULT:'||(${closeFirst?close:swap})::text;
    SELECT 'OUT_STATE:'||current_state FROM public.dealer_attendance WHERE id='${id(41)}';\n\\echo HELD\n`);
   await until(()=>holder.output().includes('HELD'));const first=parse(holder.output());
   if(closeFirst)assert.equal(first.closed,true);else if(workerFlow)assert.equal(first.status,'success',JSON.stringify(first));else assert.equal(first.outcome,'swung',JSON.stringify(first));
   waiter=session(app+'_waiter');waiter.child.stdin.end(`BEGIN;${closeFirst?swapAuth:auth}SELECT 'RESULT:'||(${closeFirst?swap:close})::text;COMMIT;\n`);
   await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}_waiter' AND wait_event_type='Lock');`)==='t');
   holder.child.stdin.end('COMMIT;\n');await holder.closed;
   // Original exact-assignment check or the forward early-session fence both
   // reject the late writer; neither may return success or leave a receipt.
   if(closeFirst)await assert.rejects(waiter.closed,/SWING_ASSIGNMENT_CONTEXT_MISMATCH|TABLE_SESSION_STALE/);
   else assert.equal(parse(await waiter.closed).closed,true);
   }
   assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${sid}';`),'t');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${sid}' AND released_at IS NULL;`),'0');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE table_id='${table}' AND status IN('predicted','announced','executing');`),'0');
   assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE id IN('${id(41)}','${incoming}') AND (pre_assigned_table_id IS NOT NULL OR current_state IN('assigned','pre_assigned','in_transition'));`),'0');
   assert.equal(timeFacts(),facts,'table close must not fabricate checkout/worked/OT');
   if(order==='swing-first'){
    const stateAfterSwing=holder.output().split('\n').find(line=>line.startsWith('OUT_STATE:')).slice(10);
    assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${id(41)}';`),stateAfterSwing,
     'close must preserve the actual canonical handoff rest state, not invent one');
   }
   assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}';`),'f');
   assert.equal(JSON.parse(sql(`BEGIN;${auth}SELECT ${close};COMMIT;`)).closed,true,'close response-loss replay remains terminal');
   if(order==='swing-first'||order==='completion-fault'){
    const replay=JSON.parse(sql(`BEGIN;${auth}SELECT ${swing};COMMIT;`));assert.equal(replay.outcome,'swung');assert.equal(replay.idempotent,true);
    assert.equal(classifyManualSwingOutcome(replay).kind,'success','actual extended canonical receipt remains compatible with UI consumer');
    assert.equal(replay.rotation_schedule_id,planned.schedule_id);assert.equal(replay.rotation_completion,'executed');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${sid}';`),'2','replay after close cannot assign again');
    assert.equal(sql(`SELECT status FROM public.dealer_rotation_schedule WHERE id='${planned.schedule_id}';`),'executed');
   }else assert.equal(sql(`SELECT count(*) FROM public.dealer_swing_operator_requests WHERE club_id='${club}' AND request_id='${swingKey}';`),'0','worker or rejected late swing leaves no operator receipt');
   if(workerFlow&&!closeFirst){
    const replay=JSON.parse(sql(`BEGIN;${swapAuth}SELECT ${swap};COMMIT;`));assert.equal(replay.status,'success');assert.equal(replay.rotation_completion,'executed');
    assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${sid}';`),'2');
    assert.equal(sql(`SELECT out_attendance_id FROM public.dealer_rotation_schedule WHERE id='${planned.schedule_id}';`),id(41));
   }
   assert.equal(financial(),before,'concurrency changed financial ledgers');
   console.log((order==='worker-next'?'OPERATOR_NEXT_PLAN_ACTUAL_WORKER_EXECUTE_REPLAY_CLOSE_PASS':order==='completion-fault'?'CANONICAL_MANUAL_SWING_ATOMIC_COMPLETION_FAULT_RETRY_PASS':'CANONICAL_CLOSE_SWING_TRUE_LOCK_'+order.toUpperCase().replaceAll('-','_')+'_PASS'),JSON.stringify({club,table,session:sid,assignment:assignment.id,closeKey,swingKey,auto:false,retained:'TEST metadata and immutable receipts'}));
  }finally{
   for(const handle of [holder,waiter])if(handle){if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');await handle.closed.catch(()=>{});}
  }
 }
 }finally{
  if(authUsage==='f')sql('REVOKE USAGE ON SCHEMA auth FROM authenticated;');
  assert.equal(sql("SELECT has_schema_privilege('authenticated','auth','USAGE');"),authUsage,'preserve prior native auth schema model grant');
 }
}
