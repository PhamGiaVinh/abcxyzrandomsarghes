export type InitialAssignmentIntent = {
  expected_actor_id: string; expected_club_id: string; table_id: string;
  table_session_id: string; force_dealer_id: string; idempotency_key: string;
};
type Journal = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export function initialAssignmentKey(i:InitialAssignmentIntent) {
  return `vinpoker:manual-assign:${JSON.stringify([i.expected_actor_id,i.expected_club_id,i.table_id,i.table_session_id,i.force_dealer_id])}`;
}
/** Preserve the existing key+UUID format; the key carries the whole identity. */
export function listInitialAssignmentIntents(storage:Journal,actor:string,club:string):InitialAssignmentIntent[] {
  const prefix=`vinpoker:manual-assign:${JSON.stringify([actor,club]).slice(0,-1)},`;
  const result:InitialAssignmentIntent[]=[];
  for(let n=0;n<storage.length;n++){
    const key=storage.key(n);if(!key?.startsWith(prefix))continue;
    const scope:unknown=JSON.parse(key.slice("vinpoker:manual-assign:".length)),request=storage.getItem(key);
    if(!Array.isArray(scope)||scope.length!==5||!scope.every(uuid)||scope[0]!==actor||scope[1]!==club||!uuid(request))
      throw new Error("Journal gán dealer không hợp lệ. Giữ nguyên dữ liệu để kiểm tra; chưa gửi yêu cầu mới.");
    result.push({expected_actor_id:actor,expected_club_id:club,table_id:scope[2],table_session_id:scope[3],force_dealer_id:scope[4],idempotency_key:request as string});
  }
  return result.sort((a,b)=>initialAssignmentKey(a).localeCompare(initialAssignmentKey(b)));
}
export function assertInitialAssignmentIntent(storage:Pick<Storage,"getItem">,i:InitialAssignmentIntent){
  if(storage.getItem(initialAssignmentKey(i))!==i.idempotency_key)throw new Error("Yêu cầu gán đã thay đổi. Hãy đọc lại journal.");
}
export function clearInitialAssignmentIntent(storage:Pick<Storage,"getItem"|"removeItem">,i:InitialAssignmentIntent){
  assertInitialAssignmentIntent(storage,i);storage.removeItem(initialAssignmentKey(i));
  if(storage.getItem(initialAssignmentKey(i))!==null)throw new Error("Chưa lưu được trạng thái đối chiếu.");
}
export function initialAssignmentReceipt(value:unknown,i:InitialAssignmentIntent):"found"|"not_found"|"unknown" {
  if(!value||typeof value!=="object"||Array.isArray(value))return "unknown";
  const v=value as Record<string,unknown>;
  if(v.mode!=="receipt"||Object.entries(i).some(([k,x])=>v[k]!==x))return "unknown";
  if(v.status==="receipt_not_found"&&v.assignment===null)return "not_found";
  const a=v.assignment;
  return v.status==="receipt_found"&&!!a&&typeof a==="object"&&"id" in a&&uuid(a.id)
    &&"status" in a&&a.status==="success"?"found":"unknown";
}
