export interface PayoutEditIntent {
  actorId: string; tournamentId: string; backend: string; requestId: string; expectedRunId: string;
  pool: number; reason: string; rows: { position: number; amount: number }[];
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function payoutEditBackend(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("PAYOUT_EDIT_BACKEND_INVALID");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("PAYOUT_EDIT_BACKEND_INVALID");
  return url.origin + url.pathname.replace(/\/+$/, "");
}
export function payoutEditJournalKey(actorId: string, tournamentId: string, backend: string): string {
  return `vinpoker:payout-edit:v1:${JSON.stringify([payoutEditBackend(backend), actorId, tournamentId])}`;
}
export function parsePayoutEditIntent(raw: string, actorId: string, tournamentId: string, backend: string): PayoutEditIntent {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || Object.keys(value).length !== 8 || value.actorId !== actorId || value.tournamentId !== tournamentId
    || value.backend !== payoutEditBackend(backend) || ![value.actorId, value.tournamentId, value.requestId, value.expectedRunId].every(uuid)
    || typeof value.pool !== "number" || !Number.isSafeInteger(value.pool) || value.pool <= 0
    || typeof value.reason !== "string" || !value.reason.trim() || value.reason !== value.reason.trim()
    || !Array.isArray(value.rows) || value.rows.length === 0) throw new Error("PAYOUT_EDIT_JOURNAL_INVALID");
  let total = 0, previous = Infinity;
  value.rows.forEach((row: unknown, index: number) => {
    if (!record(row) || Object.keys(row).length !== 2 || row.position !== index + 1
      || typeof row.amount !== "number" || !Number.isSafeInteger(row.amount) || row.amount < 0 || row.amount > previous) throw new Error("PAYOUT_EDIT_JOURNAL_INVALID");
    total += row.amount; previous = row.amount;
  });
  if (!Number.isSafeInteger(total) || total !== value.pool) throw new Error("PAYOUT_EDIT_JOURNAL_INVALID");
  return value as unknown as PayoutEditIntent;
}
export function payoutEditPayload(i: PayoutEditIntent) {
  return { tournament_id: i.tournamentId, expected_run_id: i.expectedRunId, rows: i.rows, reason: i.reason };
}
export function payoutEditArguments(i: PayoutEditIntent) {
  return { p_tournament_id: i.tournamentId, p_rows: i.rows, p_reason: i.reason,
    p_expected_run_id: i.expectedRunId, p_request_id: i.requestId, p_expected_actor: i.actorId };
}
export type PayoutEditResolution = {status: "unknown"} | {status: "not_found"} | {status: "cancelled"} | {status: "saved"; runId: string};
export function resolvePayoutEditResult(i: PayoutEditIntent, raw: unknown): PayoutEditResolution {
  if (!record(raw) || raw.actor_id !== i.actorId || raw.tournament_id !== i.tournamentId || raw.request_id !== i.requestId
    || raw.previous_run_id !== i.expectedRunId) return {status: "unknown"};
  if (raw.status === "cancelled" && raw.run_id === undefined) return {status: "cancelled"};
  if (raw.status !== "saved" || !uuid(raw.run_id) || raw.run_id === i.expectedRunId || raw.itm_places !== i.rows.length) return {status: "unknown"};
  return {status: "saved", runId: raw.run_id};
}
export function resolvePayoutEditReceipt(i: PayoutEditIntent, raw: unknown): PayoutEditResolution {
  if (!record(raw) || raw.actor_id !== i.actorId || raw.tournament_id !== i.tournamentId || raw.request_id !== i.requestId) return {status: "unknown"};
  if (raw.status === "not_found") return {status: "not_found"};
  if (raw.status !== "found" || !record(raw.intent) || Object.keys(raw.intent).length !== 4) return {status: "unknown"};
  const payload = payoutEditPayload(i), received = raw.intent;
  if (received.tournament_id !== payload.tournament_id || received.expected_run_id !== payload.expected_run_id
    || received.reason !== payload.reason || !Array.isArray(received.rows) || received.rows.length !== i.rows.length
    || !received.rows.every((row: unknown, index: number) => record(row) && Object.keys(row).length === 2
      && row.position === i.rows[index].position && row.amount === i.rows[index].amount)) return {status: "unknown"};
  return resolvePayoutEditResult(i, raw.result);
}
export function persistPayoutEditIntent(storage: Pick<Storage, "getItem" | "setItem">, i: PayoutEditIntent) {
  const key = payoutEditJournalKey(i.actorId, i.tournamentId, i.backend), raw = JSON.stringify(i), prior = storage.getItem(key);
  if (prior !== null && prior !== raw) throw new Error("PAYOUT_EDIT_JOURNAL_PENDING");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("PAYOUT_EDIT_JOURNAL_SAVE_FAILED");
}
export function clearPayoutEditIntent(storage: Pick<Storage, "getItem" | "removeItem">, i: PayoutEditIntent) {
  const key = payoutEditJournalKey(i.actorId, i.tournamentId, i.backend), prior = storage.getItem(key);
  if (prior === null) return;
  if (prior !== JSON.stringify(i)) throw new Error("PAYOUT_EDIT_JOURNAL_CHANGED");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("PAYOUT_EDIT_JOURNAL_CLEAR_FAILED");
}
