import { canonicalVoiceJson } from "./trackerVoice/canonicalRequest";

export type DealerManualSwingIntent = {
  actor_user_id: string; club_id: string; table_id: string; table_session_id: string;
  assignment_id: string; expected_version: number; request_id: string;
};
type Scope = Pick<DealerManualSwingIntent, "actor_user_id" | "club_id">;
type Journal = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function validManualSwingIntent(v: unknown): v is DealerManualSwingIntent {
  return record(v) && Object.keys(v).length === 7
    && [v.actor_user_id, v.club_id, v.table_id, v.table_session_id, v.assignment_id, v.request_id].every(uuid)
    && Number.isSafeInteger(v.expected_version) && Number(v.expected_version) >= 0;
}
export const manualSwingJournalKey = (scope: Scope) => `vinpoker:manual-swing:v1:${scope.actor_user_id}:${scope.club_id}`;
export function readManualSwingIntent(storage: Pick<Storage, "getItem">, scope: Scope): DealerManualSwingIntent | null {
  const raw = storage.getItem(manualSwingJournalKey(scope));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!validManualSwingIntent(value) || value.actor_user_id !== scope.actor_user_id || value.club_id !== scope.club_id)
    throw new Error("Yêu cầu Swing đã lưu không hợp lệ. Không gửi lệnh mới.");
  return value;
}
export function assertManualSwingIntent(storage: Pick<Storage, "getItem">, intent: DealerManualSwingIntent) {
  if (canonicalVoiceJson(readManualSwingIntent(storage, intent)) !== canonicalVoiceJson(intent))
    throw new Error("Yêu cầu Swing đã thay đổi. Hãy đọc lại yêu cầu đã lưu.");
}
export function persistManualSwingIntent(storage: Journal, intent: DealerManualSwingIntent) {
  if (!validManualSwingIntent(intent)) throw new Error("Context Swing không hợp lệ.");
  const previous = readManualSwingIntent(storage, intent);
  if (previous && canonicalVoiceJson(previous) !== canonicalVoiceJson(intent))
    throw new Error("Còn yêu cầu Swing chưa được đối chiếu.");
  storage.setItem(manualSwingJournalKey(intent), JSON.stringify(intent));
  assertManualSwingIntent(storage, intent);
}
export function clearManualSwingIntent(storage: Journal, intent: DealerManualSwingIntent) {
  assertManualSwingIntent(storage, intent);
  storage.removeItem(manualSwingJournalKey(intent));
  if (storage.getItem(manualSwingJournalKey(intent)) !== null) throw new Error("Chưa lưu được trạng thái đã đối chiếu.");
}
export function manualSwingReceipt(value: unknown, intent: DealerManualSwingIntent):
  { status: "found"; response: unknown } | { status: "not_found" | "unknown" } {
  if (!record(value) || Object.entries(intent).some(([key, expected]) => value[key] !== expected)) return { status: "unknown" };
  if (value.status === "receipt_not_found" && value.response === null) return { status: "not_found" };
  if (value.status === "receipt_found" && record(value.response)) return { status: "found", response: value.response };
  return { status: "unknown" };
}
export function manualSwingWriterArgs(intent: DealerManualSwingIntent) {
  return { p_assignment_id: intent.assignment_id, p_table_id: intent.table_id,
    p_table_session_id: intent.table_session_id, p_expected_version: intent.expected_version, p_request_id: intent.request_id };
}
export function manualSwingReaderArgs(intent: DealerManualSwingIntent) {
  return { ...manualSwingWriterArgs(intent), p_actor_user_id: intent.actor_user_id, p_club_id: intent.club_id };
}
