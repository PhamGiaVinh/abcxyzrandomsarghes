function percentile(values,p){const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.ceil(p*sorted.length)-1]??null;}
export function summarizeReadQualification({samples,elapsedMs,documents,months,financialFactsUnchanged,terminalError}) {
  const results=Object.fromEntries(['report','statement'].map(kind=>{
    const rows=samples.filter(s=>s.kind===kind);
    return [kind,{count:rows.length,errors:rows.filter(s=>s.ok!==true || s.incomplete===true || s.error!=null).length,
      p95Ms:percentile(rows.map(s=>s.latencyMs),0.95),maxMs:rows.length?Math.max(...rows.map(s=>s.latencyMs)):null}];
  }));
  const qualification=!terminalError && financialFactsUnchanged===true && documents===100000 && months===12
    && elapsedMs>=1800000 && elapsedMs<=1815000 && samples.length===7200
    && new Set(samples.map(s=>`${s.actor}:${s.slot}`)).size===7200
    && samples.every(s=>Number.isInteger(s.actor) && s.actor>=0 && s.actor<20
      && Number.isInteger(s.slot) && s.slot>=0 && s.slot<360 && s.kind===(s.slot%2===0?'report':'statement')
      && s.ok===true && s.incomplete!==true && s.error==null && Number.isFinite(s.latencyMs) && s.latencyMs>=0)
    && results.report.count===3600 && results.statement.count===3600
    && results.report.p95Ms<=5000 && results.statement.p95Ms<=2000;
  return {qualification,results};
}
