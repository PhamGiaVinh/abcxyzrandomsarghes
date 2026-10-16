// Actual ready Edge handler and inventory/auth helpers; synthetic query/RPC
// transports. Proves selection behavior, not live SQL or 40-table capacity.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import {runInNewContext} from 'node:vm';import {execFileSync} from 'node:child_process';
import {getDealerOperationalTables} from '../../supabase/functions/_shared/dealerOperationalTables.ts';
import {authorizeInternalTrigger,authorizeSwingWorkerRequest,getIdempotencyKey,parseDealerReadyPayload} from '../../supabase/functions/_shared/internal-trigger-auth.ts';
const raw=process.argv.includes('--baseline')
 ?execFileSync('git',['show','5413960f27ee9928dbf800c929936ca18e59e511:VinPoker/supabase/functions/process-swing-on-dealer-ready/index.ts'],{encoding:'utf8'})
 :readFileSync('supabase/functions/process-swing-on-dealer-ready/index.ts','utf8');
const source=stripTypeScriptTypes(raw.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
const id=n=>`e1800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function run({releasedHistory=true}={}){
 const now=Date.now(),calls=[],metrics=[];let handler;
 const assignments=[...(releasedHistory?[{id:id(8),club_id:id(2),version:7,table_id:id(3),table_session_id:id(44),status:'assigned',released_at:new Date(now-60000).toISOString(),swing_due_at:new Date(now-600000).toISOString()}]:[]),
  {id:id(9),club_id:id(2),version:2,table_id:id(33),table_session_id:id(34),status:'assigned',released_at:null,swing_due_at:new Date(now-120000).toISOString()}];
 const admin={rpc:async(name,args)=>{calls.push({name,args});
  if(name==='get_dealer_operational_tables_v1')return {data:[{id:id(3),table_session_id:id(4),table_name:'TEST empty with released history',table_type:'cash'},
   {id:id(33),table_session_id:id(34),table_name:'TEST overdue current',table_type:'cash'}],error:null};
  if(name==='atomic_dealer_ready_check')return {data:{attendance_id:id(5),rest_threshold_min:15,rest_min:15},error:null};
  if(name==='worker_perform_swing')return args.p_assignment_id===id(9)?{data:{outcome:'swung',new_assignment_id:id(10)},error:null}:{data:null,error:{message:'SWING_ASSIGNMENT_CONTEXT_MISMATCH'}};
  assert.fail('unexpected RPC '+name);},
  from(table){const predicates=[];let order=null,limit=Infinity;const q={
   select(){return q;},eq(column,value){predicates.push(r=>r[column]===value);return q;},in(column,values){predicates.push(r=>values.includes(r[column]));return q;},
   is(column,value){predicates.push(r=>r[column]===value);return q;},lt(column,value){predicates.push(r=>r[column]<value);return q;},order(column){order=column;return q;},limit(n){limit=n;return q;},
   async maybeSingle(){
    if(table==='club_settings')return {data:{auto_swing_enabled:true},error:null};
    if(table==='swing_config')return {data:{rotation_planner_enabled:false},error:null};
    assert.equal(table,'dealer_assignments');const rows=assignments.filter(r=>predicates.every(p=>p(r))).sort((a,b)=>String(a[order]).localeCompare(String(b[order]))).slice(0,limit);
    return {data:rows[0]??null,error:null};},
   async insert(row){assert.equal(table,'cron_metrics');metrics.push(row);return {data:null,error:null};},
  };return q;},
 };
 runInNewContext(source,{Request,Response,console,Date,getDealerOperationalTables,getIdempotencyKey,parseDealerReadyPayload,
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
