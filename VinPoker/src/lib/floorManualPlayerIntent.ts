/** Durable intent and receipt boundary for the manual walk-in writer. No chip math. */
export type ManualPlayerIntent = {
  actorId: string; tournamentId: string; tableId: string; sessionId: string;
  name: string; seat: number; revision: number; epoch: number; requestId: string; resolved?: boolean;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown, min: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function manualPlayerPayload(i: ManualPlayerIntent) {
  return { tournament_id: i.tournamentId, player_name: i.name, tournament_table_id: i.tableId,
    seat_number: i.seat, table_session_id: i.sessionId, expected_revision: i.revision, expected_control_epoch: i.epoch };
}
export function readManualPlayerIntent(raw: string, scope: Pick<ManualPlayerIntent, "actorId" | "tournamentId" | "tableId" | "sessionId">): ManualPlayerIntent {
  const i: unknown = JSON.parse(raw);
  if (!record(i) || ![i.actorId, i.tournamentId, i.tableId, i.sessionId, i.requestId].every(uuid)
    || (["actorId", "tournamentId", "tableId", "sessionId"] as const).some((k) => i[k] !== scope[k])
    || typeof i.name !== "string" || i.name !== i.name.trim() || i.name.length < 2 || i.name.length > 100
    || !integer(i.seat, 1) || i.seat > 9 || !integer(i.revision, 0) || !integer(i.epoch, 0)
    || (i.resolved !== undefined && typeof i.resolved !== "boolean")) throw new Error("MANUAL_PLAYER_JOURNAL_INVALID");
  return i as ManualPlayerIntent;
}
export type ManualPlayerReceipt = { display_name: string; table_number: number | null; seat_number: number;
  receipt_code: string; starting_stack: number };
export function validateManualPlayerReceipt(i: ManualPlayerIntent, value: unknown):
  | { status: "unknown" } | { status: "rejected"; error: string } | { status: "committed"; receipt: ManualPlayerReceipt } {
  if (!record(value) || value.actor_id !== i.actorId || value.request_id !== i.requestId || !record(value.payload)) return { status: "unknown" };
  const expected = manualPlayerPayload(i);
  const payload = value.payload;
  if (Object.keys(payload).length !== Object.keys(expected).length
    || Object.entries(expected).some(([k, v]) => payload[k] !== v)) return { status: "unknown" };
  if (value.ok === false && typeof value.error === "string" && value.error) return { status: "rejected", error: value.error };
  if (value.ok !== true || value.tournament_table_id !== i.tableId || value.table_session_id !== i.sessionId
    || value.seat_number !== i.seat || value.control_epoch !== i.epoch || value.revision !== i.revision + 1
    || ![value.entry_id, value.seat_id, value.receipt_id].every(uuid)
    || value.display_name !== i.name || typeof value.receipt_code !== "string" || !value.receipt_code
    || !integer(value.starting_stack, 1) || (value.table_number !== null && !integer(value.table_number, 1))) return { status: "unknown" };
  return { status: "committed", receipt: value as unknown as ManualPlayerReceipt };
}
/** Keep the last settled ID: even a newer settled request fences late replies. */
export function settleManualPlayerIntent(storage: Pick<Storage, "getItem" | "setItem">, key: string, intent: ManualPlayerIntent) {
  const stored = storage.getItem(key);
  const settled = JSON.stringify({ ...intent, resolved: true });
  if (stored !== null && stored !== JSON.stringify(intent) && stored !== settled) throw new Error("MANUAL_PLAYER_JOURNAL_CHANGED");
  storage.setItem(key, settled);
  if (storage.getItem(key) !== settled) throw new Error("MANUAL_PLAYER_JOURNAL_SETTLE_FAILED");
}
/** A hung transport is an unknown outcome, never a reason to issue another key. */
export async function waitForManualPlayerResponse<T>(response: Promise<T>, timeoutMs = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([response, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("MANUAL_PLAYER_OUTCOME_UNKNOWN")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
