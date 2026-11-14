// Diagnostic classification only. Never return text from the response, and
// never change whether a request counts as a failed qualification sample.
export function classifyEdgeFailure(body){
 const text=typeof body==='string'?body.slice(0,8192):'';
 if(/\bWorkerAlreadyRetired\b/.test(text))return 'worker_retired';
 if(/\bWORKER_(?:RESOURCE_)?LIMIT\b|\bCPUTime\b|CPU time (?:soft|hard) limit/i.test(text))return 'worker_resource_limit';
 if(/\bBOOT_ERROR\b|\bInvalidWorkerCreation\b|worker boot error/i.test(text))return 'worker_boot';
 if(/\bWorkerRequestCancelled\b/.test(text))return 'worker_cancelled';
 if(/\bWorkerRequestIdleTimeout\b/.test(text))return 'worker_idle_timeout';
 return 'unknown';
}
// Allowlisted diagnostics only. The caller retains every original failure gate.
export function sanitizeHudAttemptTrace(attempts){
 if(!Array.isArray(attempts))return [];
 return attempts.slice(-8).map(value=>{
  const row={};
  for(const key of ['attempt','launchedAt','headersAt','completedAt','httpStatus','upstreamMs','proxyMs','elapsedMs',
   'postgrest_jwtMs','postgrest_parseMs','postgrest_planMs','postgrest_transactionMs','postgrest_responseMs']){
   const n=value?.[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER)row[key]=n;
  }
  if(['current','updating','warming','unavailable','revoked','unknown'].includes(value?.state))row.state=value.state;
  return row;
 });
}
export function classifyHudReadFailure(error){
 if(error?.publicHudRevalidationExpired===true)return 'revalidation_budget_expired_in_wait';
 if(error?.publicHudDeadline===true)return error.publicHudRevalidationPhase==='rpc'?'revalidation_budget_expired_in_rpc':'physical_rpc_deadline';
 if(error?.publicHudCallerCancelled===true)return 'caller_cancelled';
 if(error?.message==='PUBLIC_HUD_INVALID_PREPARATION')return 'invalid_preparation';
 return 'unknown';
}
export function classifyTableReadFailure(error){
 if(error?.message==='PUBLIC_TABLE_DEADLINE')return 'rpc_deadline';
 if(error?.publicTableCallerCancelled===true)return 'caller_cancelled';
 if(error?.code==='ERR_ASSERTION')return 'scope_assertion';
 if(error?.message==='PUBLIC_TABLE_UNAVAILABLE')return 'unavailable';
 return 'unknown';
}

// Retain scan/timing metadata, never Query Text, filter values or function SQL.
export function sanitizeWriterNestedPlans(stderr){
 const scans=[];let captured=0;
 for(const match of String(stderr??'').matchAll(/plan:\s*(\{[\s\S]*?\n\})/g)){
  try{
   const root=JSON.parse(match[1]);if(!root.Plan)continue;captured++;
   const visit=node=>{
    const safeName=value=>typeof value==='string'&&/^[a-z][a-z0-9_]*$/.test(value)?value:undefined;
    if(node['Relation Name'])scans.push({node:node['Node Type'],table:safeName(node['Relation Name']),index:safeName(node['Index Name']),rows:node['Actual Rows'],loops:node['Actual Loops'],removed:node['Rows Removed by Filter'],totalMs:node['Actual Total Time']});
    for(const child of node.Plans??[])visit(child);
   };visit(root.Plan);
  }catch{/* A truncated diagnostic does not change the measured write result. */}
 }
 scans.sort((a,b)=>(b.totalMs??0)*(b.loops??1)-(a.totalMs??0)*(a.loops??1));
 return {capturedPlans:captured,scans:scans.slice(0,40)};
}
// Diagnostic error classes only; arbitrary database text never leaves capture.
export function writerCaptureFailureKind(error,capturedPlans){
 if(capturedPlans>0)return null;
 const text=String(error?.stderr??'');
 if(error?.code==='ENOBUFS'||/maxBuffer/i.test(String(error?.message??'')))return 'capture_buffer_limit';
 if(/permission denied|must be superuser|not allowed|not permitted/i.test(text))return 'instrumentation_permission';
 if(/could not access file|No such file|could not load library/i.test(text))return 'instrumentation_unavailable';
 if(/writer_plan_capture/.test(text))return 'logs_not_returned';
 return 'capture_unavailable';
}

// Only this function's explicit telemetry prefix and fixed scalar fields leave logs.
export function sanitizeIsolateShutdowns(log){
 const events=[];
 for(const match of String(log).matchAll(/PUBLIC_HUD_ISOLATE_DIAGNOSTIC (\{[^\r\n]*\})/g)){
  if(events.length>=1000)break;
  try{const value=JSON.parse(match[1]);
   if(value.kind!=='PUBLIC_HUD_ISOLATE_SHUTDOWN'||!['CPUTime','WallClockTime','Memory','MemoryLimit','EarlyDrop','TerminationRequested','unknown'].includes(value.reason))continue;
   if(!['ageMs','received','completed','active'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0&&value[k]<=1000000000)||value.received!==value.completed+value.active)continue;
   events.push({reason:value.reason,ageMs:value.ageMs,received:value.received,completed:value.completed,active:value.active});
  }catch{}
 }
 return events;
}
