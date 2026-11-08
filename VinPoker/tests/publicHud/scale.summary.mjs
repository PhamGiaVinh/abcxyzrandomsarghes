// API latency is a single completed response, not time between preparation
// attempts. Ready responses have their own gate so placeholders cannot dilute it.
export function maximumSample(values){
 let maximum=0;for(const value of values)maximum=Math.max(maximum,value);return maximum;
}
export function summaryApiReport(samples){
 if(samples.some(s=>!Number.isFinite(s.ms)||s.ms<0))throw Error('INVALID_HUD_HTTP_TIMING');
 const distribution=rows=>{const values=rows.map(s=>s.ms).sort((a,b)=>a-b);return {samples:values.length,p95Ms:values.length?values[Math.min(values.length-1,Math.floor(values.length*.95))]:null};};
 const counts=rows=>Object.fromEntries([...new Set(rows.map(s=>s.state))].map(state=>[state,rows.filter(s=>s.state===state).length]));
 const subset=rows=>({all:distribution(rows),ready:distribution(rows.filter(s=>s.ready)),states:counts(rows)});
 const phases=[...new Set(samples.map(s=>s.phase))];
 return {...subset(samples),byPhase:Object.fromEntries(phases.map(phase=>[phase,subset(samples.filter(s=>s.phase===phase))]))};
}
