export function handIncludesWrite(hand,expected){
 return Boolean(hand&&(hand.handNumber>expected.number||(hand.id===expected.handId&&
  (expected.step===5?hand.status==='completed':Array.isArray(hand.actions)&&hand.actions.length>=expected.step))));
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
