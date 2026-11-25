function percentile(values,p){const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.ceil(p*sorted.length)-1]??null;}
export function summarizeReadQualification({samples,elapsedMs,documents,lines,months,financialFactsUnchanged,catalogFactsUnchanged,terminalError}) {
  const results=Object.fromEntries(['history','statement'].map(kind=>{
    const rows=samples.filter(s=>s.kind===kind);
    return [kind,{count:rows.length,errors:rows.filter(s=>s.ok!==true || s.incomplete===true || s.error!=null).length,
      p95Ms:percentile(rows.map(s=>s.latencyMs),0.95),maxMs:rows.length?Math.max(...rows.map(s=>s.latencyMs)):null}];
  }));
  const qualification=!terminalError && financialFactsUnchanged===true && catalogFactsUnchanged===true
    && documents===100000 && lines===500000 && months===12 && Number.isFinite(elapsedMs)
    && elapsedMs>=1800000 && elapsedMs<=1815000 && samples.length===7200
    && new Set(samples.map(s=>`${s.actor}:${s.slot}`)).size===7200
    && samples.every(s=>Number.isInteger(s.actor) && s.actor>=0 && s.actor<20
      && Number.isInteger(s.slot) && s.slot>=0 && s.slot<360 && s.kind===(s.slot%2===0?'history':'statement')
      && s.ok===true && s.incomplete!==true && s.error==null && Number.isFinite(s.latencyMs) && s.latencyMs>=0
      && Number.isFinite(s.queueMs) && s.queueMs>=0 && s.latencyMs>=s.queueMs)
    && results.history.count===3600 && results.statement.count===3600
    && results.history.p95Ms<=2000 && results.statement.p95Ms<=2000;
  return {qualification,results};
}
