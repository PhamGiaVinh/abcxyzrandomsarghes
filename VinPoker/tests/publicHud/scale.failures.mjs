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
