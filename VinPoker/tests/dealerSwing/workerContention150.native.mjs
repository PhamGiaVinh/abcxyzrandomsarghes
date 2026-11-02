import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

function serviceTransaction(service,name){
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1']);
 let out='',error='';child.stdin.on('error',()=>{});child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>error+=v);
 const result=new Promise(resolve=>{child.once('error',e=>resolve({code:-1,out,error:String(e)}));child.once('close',code=>resolve({code,out,error}))});
 const write=q=>{if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.write(q+'\n')};
 const end=q=>{if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end(q+'\n')};
 write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';${service}`);
 return {result,write,end,output:()=>out};
}

// Forty-table scope; two real PG workers compete per table, not40 concurrent
// browser users/Edge requests. The seeded overdue times are synthetic, not soak.
export async function runWorkerContention150({sql,seed,service,sharedIncoming=false,compensation=false,fallbackDeficit=false}){
 assert.equal(process.env.VINPOKER_NATIVE_READY_CAPACITY,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const funds=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const size=sharedIncoming?2:40;
 const beforeFunds=funds(),c=seed(size,{atomic:true});
 let restDeficit=0;
 if(compensation){
  assert.ok(sharedIncoming);
  sql(`UPDATE public.dealer_attendance SET check_in_time=now()-interval '5 minutes' WHERE id='${c.rows[fallbackDeficit?1:0].nextAttendance}';`);
  const verification=JSON.parse(sql(`${service}SELECT public.atomic_dealer_ready_check('${c.club}','${c.rows[0].nextAttendance}');`));
  assert.equal(verification.verified,true);assert.equal(verification.rest_threshold_min,15);
  restDeficit=Math.max(0,verification.rest_threshold_min-verification.rest_min);
  assert.equal(restDeficit,fallbackDeficit?0:10);
 }
 const otherSettings=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY club_id),'[]')::text) FROM public.club_settings s WHERE club_id<>'${c.club}';`);
 const beforeSettings=otherSettings();
 const tx=name=>serviceTransaction(service,name);
 async function until(check){const end=Date.now()+10000;while(!check()){assert.ok(Date.now()<end,'ready150 real overlap barrier timed out');await new Promise(r=>setTimeout(r,25))}}
 let completed=0;
 try{
  for(const row of sharedIncoming?c.rows.slice(0,1):c.rows){
   const assignment=JSON.parse(sql(`SELECT jsonb_build_object('id',id,'version',version) FROM public.dealer_assignments WHERE table_id='${row.table}' AND table_session_id='${row.session}' AND status='assigned' AND released_at IS NULL;`));
   assert.ok(assignment&&Number.isSafeInteger(assignment.version));
   const call=`SELECT public.worker_perform_swing(p_assignment_id:='${assignment.id}',p_table_id:='${row.table}',p_table_session_id:='${row.session}',p_expected_version:=${assignment.version},p_next_attendance_id:='${row.nextAttendance}',p_send_to_break:=true,p_break_duration_minutes:=15,p_duration_minutes:=45,p_rest_deficit_minutes:=${restDeficit});`;
   const other=sharedIncoming?c.rows[1]:row;
   const otherAssignment=sharedIncoming?JSON.parse(sql(`SELECT jsonb_build_object('id',id,'version',version) FROM public.dealer_assignments WHERE table_id='${other.table}' AND table_session_id='${other.session}' AND status='assigned' AND released_at IS NULL;`)):assignment;
   const waiterCall=sharedIncoming?`SELECT public.worker_perform_swing(p_assignment_id:='${otherAssignment.id}',p_table_id:='${other.table}',p_table_session_id:='${other.session}',p_expected_version:=${otherAssignment.version},p_next_attendance_id:='${row.nextAttendance}',p_send_to_break:=true,p_break_duration_minutes:=15,p_duration_minutes:=45,p_rest_deficit_minutes:=${restDeficit});`:call;
   let a,b;
   try{
    a=tx('ready150_holder');a.write(call+"SELECT 'READY150_HELD';");await until(()=>a.output().includes('READY150_HELD'));
    b=tx('ready150_waiter');b.end(waiterCall+'COMMIT;');
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='ready150_waiter' AND a.application_name='ready150_holder');")==='t');
    a.end('COMMIT;');const [winner,loser]=await Promise.all([a.result,b.result]);
    assert.equal(winner.code,0,winner.error);const value=JSON.parse(winner.out.split('\n').find(line=>line.startsWith('{')));
    assert.equal(value.outcome,'swung');
    if(sharedIncoming){
     // Canonical perform_swing explicitly falls back to another eligible pool
     // attendance when the requested one becomes unavailable while waiting.
     assert.equal(loser.code,0,loser.error);
     const replacement=JSON.parse(loser.out.split('\n').find(line=>line.startsWith('{')));
     assert.equal(replacement.outcome,'swung');assert.notEqual(replacement.new_assignment_id,value.new_assignment_id);
     assert.equal(sql(`SELECT table_id||'|'||table_session_id||'|'||attendance_id FROM public.dealer_assignments WHERE id='${replacement.new_assignment_id}';`),`${other.table}|${other.session}|${other.nextAttendance}`);
     assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE attendance_id='${row.nextAttendance}' AND released_at IS NULL AND status='assigned';`),'1');
     assert.equal(sql(`SELECT count(*) FROM public.dealer_attendance WHERE id IN ('${row.oldAttendance}','${other.oldAttendance}') AND current_state='on_break';`),'2');
     assert.equal(sql(`SELECT count(*) FROM public.dealer_breaks WHERE assignment_id IN ('${assignment.id}','${otherAssignment.id}') AND break_end IS NULL AND expected_duration_minutes=15;`),'2');
     console.log('READY151_ACTUAL_DISTINCT_FALLBACK_RECEIPTS',JSON.stringify({first:value.new_assignment_id,second:replacement.new_assignment_id}));
     if(compensation){
      console.log('READY152_ACTUAL_COMPENSATION',JSON.stringify({requestedDeficit:restDeficit,first:value.rest_deficit_minutes,fallback:replacement.rest_deficit_minutes}));
      assert.equal(value.rest_deficit_minutes,restDeficit);
      const expectedFallback=fallbackDeficit?10:0;
      assert.equal(replacement.rest_deficit_minutes,expectedFallback,'compensation must belong to actual fallback attendance');
      for(const [receipt,deficit] of [[value,restDeficit],[replacement,expectedFallback]]){
       assert.equal(sql(`SELECT extract(epoch FROM (swing_due_at-assigned_at))/60=${45+deficit} FROM public.dealer_assignments WHERE id='${receipt.new_assignment_id}';`),'t','committed deadline must match effective compensation, not just response');
      }
     }
    }else{
     assert.notEqual(loser.code,0,'stale worker must not succeed');
     assert.match(loser.error,/SWING_ASSIGNMENT_CONTEXT_MISMATCH|SWING_VERSION_CONFLICT/);
    }
    assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${c.club}' AND table_id='${row.table}' AND table_session_id='${row.session}' AND attendance_id='${row.nextAttendance}' AND status='assigned' AND released_at IS NULL;`),'1');
    completed++;if(completed%10===0)console.log('READY150_ACTUAL_CONTENTION_PROGRESS',completed);
   }finally{a?.end('ROLLBACK;');b?.end('ROLLBACK;');await Promise.allSettled([a?.result,b?.result])}
  }
  assert.equal(sql(`SELECT count(*)||'|'||count(DISTINCT attendance_id)||'|'||count(DISTINCT table_session_id) FROM public.dealer_assignments WHERE club_id='${c.club}' AND status='assigned' AND released_at IS NULL;`),`${size}|${size}|${size}`);
  assert.equal(sql(`SELECT count(*) FROM public.dealer_assignments WHERE club_id='${c.club}' AND released_at IS NOT NULL;`),String(sharedIncoming?2:completed));
  console.log(sharedIncoming?'READY151_TWO_TABLES_ONE_INCOMING_NO_DOUBLE_ASSIGN_PASS':'READY150_TWO_REAL_WORKERS_FORTY_TABLE_SCOPE_NO_DOUBLE_ASSIGN_PASS',JSON.stringify({club:c.club,completed,...(sharedIncoming?{fallbacks:1}:{staleWorkersRejected:completed})}));
 }finally{
  sql(`UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${c.club}';`);
  assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${c.club}';`),'f');
  assert.equal(funds(),beforeFunds);assert.equal(otherSettings(),beforeSettings);
  console.log('READY150_FIXTURE_AUTO_OFF_FUNDS_OTHER_CLUB_SETTINGS_UNCHANGED',c.club);
 }
}

// Actual Ready handler/auth/inventory/config/metrics with PG RPCs. Only the
// worker transport is asynchronous so we can prove the real blocking barrier.
export async function runReadyEdgeCompensation153({sql,seed,service,dispatch,setWorkerInterleave,quote}){
 assert.equal(process.env.VINPOKER_NATIVE_READY_CAPACITY,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const money=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const beforeMoney=money();
 async function until(check){const deadline=Date.now()+10000;while(!check()){assert.ok(Date.now()<deadline,'ready153 overlap barrier timed out');await new Promise(r=>setTimeout(r,25))}}
 for(const fallbackDeficit of [false,true]){
  const c=seed(2,{atomic:true}),[first,second]=c.rows;
  const otherSettings=()=>sql(`SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY club_id),'[]')::text) FROM public.club_settings s WHERE club_id<>'${c.club}';`),beforeSettings=otherSettings();
  let a,b,workerCalls=0;
  try{
   sql(`INSERT INTO public.swing_config(club_id,table_type,swing_duration_minutes,break_duration_minutes) VALUES('${c.club}','cash',45,15);
    UPDATE public.dealer_attendance SET check_in_time=now()-interval '5 minutes' WHERE id='${(fallbackDeficit?second:first).nextAttendance}';
    UPDATE public.dealer_assignments SET swing_due_at=now()+interval '45 minutes' WHERE table_id='${first.table}' AND released_at IS NULL;`);
   const assignment=JSON.parse(sql(`SELECT jsonb_build_object('id',id,'version',version) FROM public.dealer_assignments WHERE table_id='${first.table}' AND released_at IS NULL AND status='assigned';`));
   setWorkerInterleave(async args=>{
    workerCalls++;
    assert.equal(args.p_table_id,second.table);assert.equal(args.p_table_session_id,second.session);
    assert.equal(args.p_next_attendance_id,first.nextAttendance);assert.equal(args.p_duration_minutes,45);
    assert.equal(args.p_rest_deficit_minutes,fallbackDeficit?0:10);
    a=serviceTransaction(service,'ready153_holder');
    a.write(`SELECT public.worker_perform_swing(p_assignment_id:='${assignment.id}',p_table_id:='${first.table}',p_table_session_id:='${first.session}',p_expected_version:=${assignment.version},p_next_attendance_id:='${first.nextAttendance}',p_send_to_break:=true,p_break_duration_minutes:=15,p_duration_minutes:=45,p_rest_deficit_minutes:=${args.p_rest_deficit_minutes});SELECT 'READY153_HELD';`);
    await until(()=>a.output().includes('READY153_HELD'));
    b=serviceTransaction(service,'ready153_waiter');
    b.end(`SELECT public.worker_perform_swing(${Object.entries(args).map(([key,value])=>(assert.match(key,/^p_[a-z_]+$/),`${key}=>${quote(value)}`)).join(',')});COMMIT;`);
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid)) WHERE b.application_name='ready153_waiter' AND a.application_name='ready153_holder');")==='t');
    a.end('COMMIT;');const [winner,waiter]=await Promise.all([a.result,b.result]);
    assert.equal(winner.code,0,winner.error);assert.equal(waiter.code,0,waiter.error);
    return {data:JSON.parse(waiter.out.split('\n').find(line=>line.startsWith('{'))),error:null};
   });
   const response=await dispatch(c.club,first.nextAttendance,c.club);
   assert.equal(workerCalls,1);assert.equal(response.status,200,JSON.stringify(response));
   assert.equal(response.body.outcome,'swung');assert.equal(response.body.rest_deficit_minutes,fallbackDeficit?10:0);
   assert.equal(response.body.table_id,second.table);
   const actual=JSON.parse(sql(`SELECT jsonb_build_object('attendance',attendance_id,'session',table_session_id,'minutes',extract(epoch FROM (swing_due_at-assigned_at))/60) FROM public.dealer_assignments WHERE id='${response.body.new_assignment_id}';`));
   assert.deepEqual(actual,{attendance:second.nextAttendance,session:second.session,minutes:fallbackDeficit?55:45});
   assert.equal(sql(`SELECT count(*)||'|'||count(DISTINCT attendance_id) FROM public.dealer_assignments WHERE club_id='${c.club}' AND status='assigned' AND released_at IS NULL;`),'2|2');
   assert.equal(sql(`SELECT current_state FROM public.dealer_attendance WHERE id='${second.oldAttendance}';`),'available','Ready send_to_break=false must stay unchanged');
   assert.equal(sql(`SELECT count(*) FROM public.cron_metrics WHERE club_id='${c.club}' AND cron_name='process-swing-on-dealer-ready' AND status='success' AND processed_count=1;`),'1');
   setWorkerInterleave(null);
   const assignments=()=>sql(`SELECT md5(jsonb_agg(to_jsonb(a) ORDER BY id)::text) FROM public.dealer_assignments a WHERE club_id='${c.club}';`),beforeReplay=assignments();
   const replay=await dispatch(c.club,first.nextAttendance,c.club);
   assert.equal(replay.status,200);assert.equal(replay.body.skipped,'state_changed');
   assert.equal(assignments(),beforeReplay,'same event replay must not assign again');
   assert.equal(sql(`SELECT count(*) FROM public.cron_metrics WHERE club_id='${c.club}' AND cron_name='process-swing-on-dealer-ready' AND status='success' AND processed_count=1;`),'1');
   console.log('READY153_ACTUAL_HANDLER_PG_COMPENSATION_PASS',JSON.stringify({club:c.club,requestedDeficit:fallbackDeficit?0:10,actualDeficit:response.body.rest_deficit_minutes,assignment:response.body.new_assignment_id,minutes:actual.minutes}));
  }finally{
   setWorkerInterleave(null);a?.end('ROLLBACK;');b?.end('ROLLBACK;');await Promise.allSettled([a?.result,b?.result]);
   sql(`UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id='${c.club}';`);
   assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${c.club}';`),'f');
   assert.equal(money(),beforeMoney);assert.equal(otherSettings(),beforeSettings);
   console.log('READY153_AUTO_OFF_FUNDS_OTHER_SETTINGS_UNCHANGED',c.club);
  }
 }
}
