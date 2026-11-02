export interface DealerNextScope {
  actorId: string;
  clubId: string;
  sessionId: string;
  assignmentId: string;
}
export interface DealerNextIntent extends DealerNextScope {
  version: number;
  attendanceId: string;
  requestId: string;
}
type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function dealerNextIntentKey(scope: DealerNextScope): string {
  return `vp:dealer-next:v1:${encodeURIComponent(JSON.stringify([
    scope.actorId, scope.clubId, scope.sessionId, scope.assignmentId,
  ]))}`;
}
export function readDealerNextIntent(storage: IntentStorage, scope: DealerNextScope): DealerNextIntent | null {
  const raw = storage.getItem(dealerNextIntentKey(scope));
  if (raw === null) return null;
  const value = JSON.parse(raw) as DealerNextIntent;
  if (!value || dealerNextIntentKey(value) !== dealerNextIntentKey(scope)
    || !Number.isInteger(value.version) || value.version < 0
    || typeof value.attendanceId !== "string" || !value.attendanceId
    || typeof value.requestId !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId)) {
    throw new Error("Stored dealer-next intent is invalid; do not issue a replacement request");
  }
  return value;
}
export function persistDealerNextIntent(storage: IntentStorage, intent: DealerNextIntent): void {
  const existing = readDealerNextIntent(storage, intent);
  if (existing && JSON.stringify(existing) !== JSON.stringify(intent)) {
    throw new Error("Resolve the previous dealer-next intent first");
  }
  const key = dealerNextIntentKey(intent), serialized = JSON.stringify(intent);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Dealer-next intent was not persisted");
}
export function clearDealerNextIntent(storage: IntentStorage, intent: DealerNextIntent): void {
  const existing = readDealerNextIntent(storage, intent);
  if (existing && JSON.stringify(existing) !== JSON.stringify(intent)) throw new Error("Dealer-next intent changed");
  storage.removeItem(dealerNextIntentKey(intent));
}
export function dealerNextIntentArgs(intent: DealerNextIntent) {
  return {
    p_table_session_id: intent.sessionId,
    p_assignment_id: intent.assignmentId,
    p_expected_assignment_version: intent.version,
    p_next_attendance_id: intent.attendanceId,
    p_request_id: intent.requestId,
  };
}
