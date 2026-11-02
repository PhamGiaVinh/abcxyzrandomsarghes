// Actual ready Edge handler and inventory/auth helpers; synthetic query/RPC
// transports. Proves selection behavior, not live SQL or 40-table capacity.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import {runInNewContext} from 'node:vm';import {execFileSync} from 'node:child_process';
import {getDealerOperationalTables} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
import {getReadySwingDuration,getReadyRestThreshold} from '../../supabase/functions/_shared/readySwingDuration.ts';
import {loadEligibleDealerAttendance} from '../../supabase/functions/_shared/dealerPoolEligibility.ts';
import {authorizeInternalTrigger,authorizeSwingWorkerRequest,getIdempotencyKey,parseDealerReadyPayload} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
const raw=process.argv.includes('--retained-target-rest-baseline')
 ?readFileSync('D:/wt/vinpoker-goal-runtime-20261028/ready-target-rest-baseline-20261029/ready-main.ts','utf8')
 :process.argv.includes('--baseline')
 ?execFileSync('git',['show','5413960f27ee9928dbf800c929936ca18e59e511:VinPoker/supabase/functions/process-swing-on-dealer-ready/index.ts'],{encoding:'utf8'})
 :readFileSync('supabase/functions/process-swing-on-dealer-ready/index.ts','utf8');
const source=stripTypeScriptTypes(raw.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const id=n=>`e1800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function run({releasedHistory=true,verificationRest=15,actualDeficit=0,eligibility='valid',tableType='cash',verificationThreshold=15}={}){
 const now=Date.now(),calls=[],metrics=[];let handler;
 const assignments=[...(releasedHistory?[{id:id(8),club_id:id(2),version:7,table_id:id(3),table_session_id:id(44),status:'assigned',released_at:new Date(now-60000).toISOString(),swing_due_at:new Date(now-600000).toISOString()}]:[]),
  {id:id(9),club_id:id(2),version:2,table_id:id(33),table_session_id:id(34),status:'assigned',released_at:null,swing_due_at:new Date(now-120000).toISOString()}];
 const admin={rpc:async(name,args)=>{calls.push({name,args});
  if(name==='get_dealer_operational_tables_v1')return {data:[{id:id(3),table_session_id:id(4),table_name:'TEST empty with released history',table_type:tableType,tournament_id:tableType==='tournament'?id(7):null},
   {id:id(33),table_session_id:id(34),table_name:'TEST overdue current',table_type:tableType,tournament_id:tableType==='tournament'?id(7):null}],error:null};
  if(name==='atomic_dealer_ready_check')return {data:{attendance_id:id(5),rest_threshold_min:verificationThreshold,rest_min:verificationRest},error:null};
  if(name==='get_dealer_pool_eligible_attendance_v1'){
   assert.deepEqual(args,{p_club_id:id(2),p_attendance_ids:[id(5)]});
   if(eligibility==='error')return {data:null,error:{message:'backend unavailable'}};
   return {data:eligibility==='malformed'?null:eligibility==='denied'?[]:[{attendance_id:id(5)}],error:null};
  }
  if(name==='worker_perform_swing')return args.p_assignment_id===id(9)?{data:{outcome:'swung',new_assignment_id:id(10),rest_deficit_minutes:actualDeficit},error:null}:{data:null,error:{message:'SWING_ASSIGNMENT_CONTEXT_MISMATCH'}};
  assert.fail('unexpected RPC '+name);},
  from(table){const predicates=[];let order=null,limit=Infinity;const q={
   select(){return q;},eq(column,value){predicates.push(r=>r[column]===value);return q;},in(column,values){predicates.push(r=>values.includes(r[column]));return q;},
   is(column,value){predicates.push(r=>r[column]===value);return q;},lt(column,value){predicates.push(r=>r[column]<value);return q;},order(column){order=column;return q;},limit(n){limit=n;return q;},
   async maybeSingle(){
    if(table==='club_settings')return {data:{auto_swing_enabled:true},error:null};
    if(table==='swing_config')return {data:{rotation_planner_enabled:false,break_duration_minutes:15,min_inter_swing_rest_minutes:15},error:null};
    if(table==='swing_configs')return {data:null,error:null};
    if(table==='tournaments')return {data:{swing_duration_minutes:30},error:null};
    assert.equal(table,'dealer_assignments');const rows=assignments.filter(r=>predicates.every(p=>p(r))).sort((a,b)=>String(a[order]).localeCompare(String(b[order]))).slice(0,limit);
    return {data:rows[0]??null,error:null};},
   async insert(row){assert.equal(table,'cron_metrics');metrics.push(row);return {data:null,error:null};},
  };return q;},
 };
 runInNewContext(source,{Request,Response,console,Date,getDealerOperationalTables,getReadySwingDuration,getReadyRestThreshold,loadEligibleDealerAttendance,getIdempotencyKey,parseDealerReadyPayload,
  authorizeInternalTrigger:req=>authorizeInternalTrigger(req,'synthetic-secret'),authorizeSwingWorkerRequest:req=>authorizeSwingWorkerRequest(req,'synthetic-worker','synthetic-internal'),
  createClient:()=>admin,Deno:{env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-worker'})[key]},serve:fn=>{handler=fn;}}});
 const response=await handler(new Request('https://synthetic.invalid/functions/v1/process-swing-on-dealer-ready',{method:'POST',headers:{Authorization:'Bearer synthetic-worker','Content-Type':'application/json','x-idempotency-key':'ready-released-history-regression'},body:JSON.stringify({club_id:id(2),attendance_id:id(5)})}));
 return {status:response.status,payload:await response.json(),calls,metrics};
}
for(const releasedHistory of [false,true]){
 const answer=await run({releasedHistory});const swing=answer.calls.find(c=>c.name==='worker_perform_swing');
 assert.equal(swing?.args.p_assignment_id,id(9),'released history cannot starve the current exact-session assignment');
 assert.equal(swing.args.p_table_session_id,id(34));assert.equal(answer.status,200);assert.equal(answer.payload.outcome,'swung');
 assert.equal(answer.metrics.at(-1).processed_count,1);
}
console.log('READY_WORKER_ACTUAL_HANDLER_RELEASED_HISTORY_SELECTION_PASS');
for(const [verificationRest,actualDeficit] of [[5,0],[15,10]]){
 const answer=await run({verificationRest,actualDeficit});
 assert.equal(answer.status,200);assert.equal(answer.payload.rest_deficit_minutes,actualDeficit,'Edge must report committed actual dealer compensation');
}
for(const actualDeficit of [null,-1,1.5,'10',NaN]){
 const answer=await run({actualDeficit});
 assert.equal(answer.status,500);assert.equal(answer.payload.error,'invalid_swing_receipt');
 assert.equal(answer.metrics.at(-1).processed_count,0);
}
console.log('READY152_ACTUAL_HANDLER_COMPENSATION_RECEIPT_PASS');
for(const eligibility of ['denied','error','malformed']){
 const answer=await run({eligibility});
 assert.equal(answer.calls.some(call=>call.name==='worker_perform_swing'),false);
 assert.equal(answer.status,eligibility==='denied'?200:503);
 if(eligibility==='denied')assert.equal(answer.payload.skipped,'attendance_operating_day_invalid');
 else assert.equal(answer.payload.error,'attendance_operating_day_unverified');
}
console.log('READY641_OPERATING_DAY_DENIED_UNKNOWN_NO_SWING_PASS');
const tournamentReady=await run({tableType:'tournament',verificationThreshold:20,verificationRest:15});
assert.equal(tournamentReady.status,200);
assert.equal(tournamentReady.calls.find(call=>call.name==='worker_perform_swing')?.args.p_rest_deficit_minutes,0,
 'a completed tournament rest must not inherit the unrelated cash threshold');
console.log('READY_TARGET_TOUR_REST15_CASH_RPC20_NO_FALSE_DEFICIT_PASS');
