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
