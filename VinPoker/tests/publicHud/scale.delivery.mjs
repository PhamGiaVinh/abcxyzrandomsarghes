export function handIncludesWrite(hand,expected){
 return Boolean(hand&&(hand.handNumber>expected.number||(hand.id===expected.handId&&
  (expected.step===5?hand.status==='completed':Array.isArray(hand.actions)&&hand.actions.length>=expected.step))));
}

// Diagnostic only. Broadcast revisions never authorize a response or replace
// the production component-epoch fence. Deferred source generations are not
// exact receipts and therefore cannot be paired this way.
export function coveringTableHintTiming(hints,expected,observation){
 if(expected.generationDeferred)return {state:'deferred-source'};
 if(typeof expected.generation!=='string'||!/^\d+$/.test(expected.generation))return {state:'unknown-generation'};
 const hint=hints.find(h=>typeof h.generation==='string'&&/^\d+$/.test(h.generation)&&
  Number.isFinite(h.at)&&h.at>=expected.at&&h.at<=observation.at&&BigInt(h.generation)>=BigInt(expected.generation));
 if(!hint)return {state:'no-retained-covering-hint'};
 return {state:'matched',sourceToHintMs:hint.at-expected.at,hintToReadStartMs:observation.startedAt-hint.at,
  readToObservationMs:observation.at-observation.startedAt};
}

// Integer millisecond histograms retain every matched delivery without one
// diagnostic object per viewer/write during the two 30-minute load scenarios.
export function createCoveringHintDiagnostics(){
 const outcomes={},fields={sourceToHintMs:new Map(),hintToReadStartMs:new Map(),readToObservationMs:new Map()};
 let samples=0,matched=0,readsStartedBeforeHint=0;
 return {
  record(timing){
   samples++;outcomes[timing.state]=(outcomes[timing.state]??0)+1;
   if(timing.state!=='matched')return;
   matched++;if(timing.hintToReadStartMs<0)readsStartedBeforeHint++;
   for(const [field,counts] of Object.entries(fields))counts.set(timing[field],(counts.get(timing[field])??0)+1);
  },
  summary(){
   const p95=counts=>{if(!matched)return null;let count=0;for(const [ms,n] of [...counts].sort((a,b)=>a[0]-b[0])){count+=n;if(count>=Math.ceil(matched*.95))return ms;}return null;};
   return {samples,matched,outcomes:{...outcomes},sourceToHintP95Ms:p95(fields.sourceToHintMs),hintToReadStartP95Ms:p95(fields.hintToReadStartMs),readToObservationP95Ms:p95(fields.readToObservationMs),readsStartedBeforeHint};
  }
 };
}
export function projectionIncludesWrite(freshness,expected,requestOrder=0){
 try{
  const generation=JSON.parse(freshness.projectedSourceRevision).generation;
  return (!expected.deferred||(freshness.state==='current'&&requestOrder>expected.ackOrder))&&/^\d+$/.test(generation??'')&&
   (!expected.deferred||BigInt(generation)>BigInt(expected.generation))&&
   BigInt(generation)>=BigInt(expected.generation)&&Date.parse(freshness.publishedAt)>=expected.at;
 }catch{return false;}
}

// A fast clock response cannot establish a felt's metadata cache until the
// companion table response has passed the consumer's scope/source fences.
export async function settleScopedFeltRead(tableRead,clockRead,isCurrent,onClockReady){
 const [reply,clockValid]=await Promise.all([tableRead,clockRead]);
 if(clockValid&&isCurrent(reply))onClockReady();
 return reply;
}
