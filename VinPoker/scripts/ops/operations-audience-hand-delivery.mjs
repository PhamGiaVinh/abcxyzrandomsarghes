import assert from 'node:assert/strict';
const tour='a3000000-0000-4000-8000-000000000001';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const keys=['kind','tournamentId','tableId','sessionId','handId','handNumber','startIntentAt','startAckAt','intentAt','ackAt','verifiedAt'];
const timingKeys=['pendingAt','dispatchAt','headersAt','bodyReadyAt'];
const summarize=values=>{
 const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
 return {samples:n,minMs:sorted[0]??null,p50Ms:n?sorted[Math.ceil(n*.5)-1]:null,p95Ms:n?sorted[Math.ceil(n*.95)-1]:null,maxMs:sorted.at(-1)??null};
};
function observationTiming(input,at){
 if(input===undefined)return undefined;
 assert.ok(input&&typeof input==='object'&&!Array.isArray(input),'Invalid diagnostic timing');
 assert.deepEqual(Object.keys(input).sort(),[...timingKeys].sort(),'Unexpected diagnostic timing fields');
 for(const key of timingKeys)assert.ok(Number.isSafeInteger(input[key])&&input[key]>0,'Invalid diagnostic clock');
 assert.ok(input.pendingAt<=input.dispatchAt&&input.dispatchAt<=input.headersAt&&input.headersAt<=input.bodyReadyAt&&input.bodyReadyAt<=at,'Invalid diagnostic clock order');
 return Object.fromEntries(timingKeys.map(key=>[key,input[key]]));
}
// The actor and audience share only synthetic scope and verified operation
// receipts. This journal is never a source of public viewer payloads.
export function validateHandDeliverySelection(input,sha){
 assert.match(sha,/^[0-9a-f]{40}$/);
 assert.ok(input&&typeof input==='object'&&!Array.isArray(input));
 assert.deepEqual(Object.keys(input).sort(),['kind','sha','nonce','tournamentId','tableId','sessionId'].sort());
 assert.equal(input.kind,'select-operational-table-v1');assert.equal(input.sha,sha);
 assert.equal(input.tournamentId,tour);
 for(const key of ['nonce','tableId','sessionId'])assert.ok(uuid(input[key]),'Invalid selection identity');
 return {...input};
}
export function readHandDeliveryJournal(text,selection){
 assert.ok(typeof text==='string'&&Buffer.byteLength(text)<=65536,'Oversized Finish journal');
 // An append can be observed mid-write. Only complete records are consumed;
 // malformed complete records fail rather than silently disappearing.
 const lines=text.split('\n');lines.pop();assert.ok(lines.length<=20,'Too many Finish receipts');
 return lines.map(line=>{
  const row=JSON.parse(line);
  assert.deepEqual(Object.keys(row).sort(),['nonce','sha','receipt'].sort());
  assert.equal(row.nonce,selection.nonce);assert.equal(row.sha,selection.sha);
  const receipt=validateOperationalFinishReceipt(row.receipt);
  assert.equal(receipt.tableId,selection.tableId);assert.equal(receipt.sessionId,selection.sessionId);
  return receipt;
 });
}
export function validateOperationalFinishReceipt(input){
 assert.ok(input&&typeof input==='object'&&!Array.isArray(input),'Invalid Finish receipt');
 assert.deepEqual(Object.keys(input).sort(),[...keys].sort(),'Unexpected Finish receipt fields');
 assert.equal(input.kind,'verified-canonical-finish-v1');assert.equal(input.tournamentId,tour);
 for(const key of ['tableId','sessionId','handId'])assert.ok(uuid(input[key]),'Invalid Finish identity');
 assert.ok(Number.isSafeInteger(input.handNumber)&&input.handNumber>=9003&&input.handNumber<=9022,'Invalid graded Finish number');
 for(const key of ['startIntentAt','startAckAt','intentAt','ackAt','verifiedAt'])assert.ok(Number.isSafeInteger(input[key])&&input[key]>0,'Invalid Finish clock');
 assert.ok(input.startIntentAt<=input.startAckAt&&input.startAckAt<=input.intentAt&&input.intentAt<=input.ackAt&&input.ackAt<=input.verifiedAt,'Invalid Finish clock order');
 // Return only the explicit synthetic receipt contract, never a caller object.
 return Object.fromEntries(keys.map(key=>[key,input[key]]));
}

// Test-only proof for the existing twenty serial canonical Finish operations.
// Intent precedes the source commit, so intent→visible is a conservative upper
// bound on source-commit→consumer-ready. No tournament-generation inference is used.
export function createOperationalHandDeliveryEvidence(viewerCount){
 assert.ok([10,1000].includes(viewerCount),'Bounded actual audience required');
 const receipts=new Map(),frames=new Map(),matches=new Map();let target=null;
 const credit=(viewer,receipt)=>{
  const key=viewer+':'+receipt.handId;if(matches.has(key))return;
  for(const frame of frames.get(viewer)??[]){
   if(frame.at<receipt.intentAt||frame.tableId!==receipt.tableId||frame.sessionId!==receipt.sessionId)continue;
   const exact=frame.handId===receipt.handId&&frame.handNumber===receipt.handNumber&&frame.status==='completed'&&frame.actions===5&&frame.pot===200;
   const later=receipts.get(frame.handId);
   // A later hand only covers an older state when that hand also has an
   // independently verified canonical receipt in this same ordered session.
   const coalesced=later&&later.handNumber===frame.handNumber&&later.handNumber>receipt.handNumber&&
    later.startIntentAt>=receipt.verifiedAt&&frame.at>=later.startIntentAt&&['in_progress','completed'].includes(frame.status);
   if(exact||coalesced){matches.set(key,{elapsedMs:frame.at-receipt.intentAt,coalesced:!exact,handNumber:receipt.handNumber,
    ...(frame.timing?{timing:{intentToDispatchMs:frame.timing.dispatchAt-receipt.intentAt,
     oldestRequestToDispatchMs:frame.timing.dispatchAt-frame.timing.pendingAt,
     dispatchToHeadersMs:frame.timing.headersAt-frame.timing.dispatchAt,
     headersToBodyMs:frame.timing.bodyReadyAt-frame.timing.headersAt,
     bodyToConsumerMs:frame.at-frame.timing.bodyReadyAt}}:{})});return;}
  }
 };
 return {
  receipt(input){
   const receipt=validateOperationalFinishReceipt(input),prior=receipts.get(receipt.handId);
   if(prior){assert.deepEqual(receipt,prior,'Conflicting Finish retry');return;}
   assert.equal(receipt.handNumber,9003+receipts.size,'Missing or reordered Finish receipt');
   if(target)assert.ok(target.tableId===receipt.tableId&&target.sessionId===receipt.sessionId,'Finish scope changed');
   else target={tableId:receipt.tableId,sessionId:receipt.sessionId};
   const previous=[...receipts.values()].at(-1);
   assert.ok(!previous||receipt.startIntentAt>=previous.verifiedAt,'Overlapping serial start/Finish receipts');
   receipts.set(receipt.handId,receipt);
   // A late verified receipt can credit an earlier real HTTP observation.
   for(const viewer of frames.keys())for(const event of receipts.values())credit(viewer,event);
  },
  observe(viewer,scope,reply,at,timing){
   assert.ok(Number.isSafeInteger(viewer)&&viewer>=0&&viewer<viewerCount,'Invalid viewer');
   assert.ok(Number.isSafeInteger(at)&&at>0,'Invalid observation clock');
   assert.ok(scope?.tournamentId===tour&&uuid(scope.tableId),'Invalid requested table scope');
   const hand=reply?.hand;
   if(reply?.access!=='public'||reply.tableId!==scope.tableId||(reply.tournamentId!==undefined&&reply.tournamentId!==tour)||!uuid(reply.tableSessionId)||
    !hand||!uuid(hand.id)||hand.tableId!==reply.tableId||hand.tableSessionId!==reply.tableSessionId||
    !Number.isSafeInteger(hand.handNumber)||!Array.isArray(hand.actions))return false;
   const frame={at,tableId:reply.tableId,sessionId:reply.tableSessionId,handId:hand.id,handNumber:hand.handNumber,
    status:hand.status,actions:hand.actions.length,pot:hand.pot,timing:observationTiming(timing,at)};
   const recent=frames.get(viewer)??[];
   assert.ok(!recent.length||at>=recent.at(-1).at,'Regressed observation clock');
   recent.push(frame);if(recent.length>8)recent.shift();frames.set(viewer,recent);
   for(const receipt of receipts.values())credit(viewer,receipt);
   return true;
  },
  report({diagnostics=false}={}){
   const rows=[...matches.values()],latencies=rows.map(row=>row.elapsedMs).sort((a,b)=>a-b);
   const expected=20*viewerCount;
   return {receipts:receipts.size,expectedReceipts:20,viewers:viewerCount,expectedDeliveries:expected,
    matchedDeliveries:matches.size,missingDeliveries:expected-matches.size,
    exactFrames:rows.filter(row=>!row.coalesced).length,coalescedFrames:rows.filter(row=>row.coalesced).length,
    p95Ms:latencies.length?latencies[Math.ceil(latencies.length*.95)-1]:null,maxMs:latencies.at(-1)??null,
    complete:receipts.size===20&&matches.size===expected,
    ...(diagnostics?{diagnostics:{kind:'OBSERVED_DELIVERY_PHASES_NOT_CAUSAL_SOURCE_TIMESTAMPS',
     timedMatches:rows.filter(row=>row.timing).length,untimedMatches:rows.filter(row=>!row.timing).length,
     finishIntentToAck:summarize([...receipts.values()].map(r=>r.ackAt-r.intentAt)),
     perHand:[...receipts.values()].map(receipt=>{
      const handRows=rows.filter(row=>row.handNumber===receipt.handNumber),timed=handRows.filter(row=>row.timing);
      return {handNumber:receipt.handNumber,finishIntentToAckMs:receipt.ackAt-receipt.intentAt,
       matchedDeliveries:handRows.length,expectedDeliveries:viewerCount,coalescedFrames:handRows.filter(row=>row.coalesced).length,
       delivery:summarize(handRows.map(row=>row.elapsedMs)),timedMatches:timed.length,
       stages:Object.fromEntries(['intentToDispatchMs','oldestRequestToDispatchMs','dispatchToHeadersMs','headersToBodyMs','bodyToConsumerMs']
        .map(key=>[key,summarize(timed.map(row=>row.timing[key]))]))};
     }),
     worstSamples:[...rows].sort((a,b)=>b.elapsedMs-a.elapsedMs).slice(0,10),
     limitations:'Timing belongs to the unchanged first credited frame, including coalesced later hands. Intent-to-dispatch may be negative for an in-flight read. Oldest pending request is not a proven hint for that Finish. Headers are not body completion. Segment p95 values are not additive. Untimed matches remain in the original delivery denominator and gate; no commit/publication causality is inferred.'}}:{}),
    clock:'Canonical positive Finish intent→real scoped consumer-ready hand observation;upper-bounds commit→observation',
    limitations:'Coalesced later canonical hands count state coverage,not proof that every intermediate hand was rendered. Exact frames check identity,status,action count and pot,not all public action contents or ending stacks. Producer commit/independent verification and actual viewer scope/clock fences must be established by the real runtime.'};
  },
 };
}
