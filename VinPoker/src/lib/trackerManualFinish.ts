import { canonicalVoiceJson } from "./trackerVoice/canonicalRequest.ts";

export type ManualFinishIntent = {
  actor_id: string; request_id: string; tournament_id: string; tournament_table_id: string;
  hand_id: string; table_session_id: string; control_epoch: number; source_revision: number;
  payload: { hand_time: string; players: unknown[]; actions: unknown[]; side_pots: unknown[];
    community_cards: string[]; pot_size: number };
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const integer = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
/** Wire shape only. Actor, tenant, lifecycle, CAS and chip rules remain server-owned. */
export function isManualFinishIntent(value: unknown): value is ManualFinishIntent {
  if (!record(value) || ![value.actor_id, value.request_id, value.tournament_id, value.tournament_table_id,
    value.hand_id, value.table_session_id].every(uuid) || !integer(value.control_epoch, 1)
    || !integer(value.source_revision, 1) || !record(value.payload)) return false;
  if (Object.keys(value).length !== 9) return false;
  const p = value.payload;
  return Object.keys(p).length === 6 && typeof p.hand_time === "string" && Number.isFinite(Date.parse(p.hand_time))
    && Array.isArray(p.players) && p.players.length > 0 && Array.isArray(p.actions) && Array.isArray(p.side_pots)
    && Array.isArray(p.community_cards) && p.community_cards.every(c => typeof c === "string") && integer(p.pot_size, 0);
}
export type ManualFinishReceipt = { ok: true; hand_id: string; actor_id: string; request_id: string;
  intent: ManualFinishIntent; committed_source_revision: number; starting_total: number; ending_total: number };
/** A completed hand with the same pot is not proof that this exact intent committed. */
export function manualFinishReceiptMatches(value: unknown, intent: ManualFinishIntent): value is ManualFinishReceipt {
  if (!record(value)) return false;
  return value.ok === true && value.hand_id === intent.hand_id && value.actor_id === intent.actor_id
    && value.request_id === intent.request_id && value.table_session_id === intent.table_session_id
    && value.control_epoch === intent.control_epoch && value.expected_source_revision === intent.source_revision
    && integer(value.committed_source_revision, intent.source_revision + 1)
    && integer(value.starting_total, 0) && value.ending_total === value.starting_total
    && canonicalVoiceJson(value.intent) === canonicalVoiceJson(intent);
}

type FinishStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FinishIdentity = Pick<ManualFinishIntent, "actor_id" | "tournament_id" | "tournament_table_id" | "hand_id">;
export function readManualFinishJournal(raw: string, identity: FinishIdentity): ManualFinishIntent {
  const value: unknown = JSON.parse(raw);
  if (!isManualFinishIntent(value) || (Object.keys(identity) as Array<keyof FinishIdentity>)
    .some(key => value[key] !== identity[key])) throw new Error("MANUAL_FINISH_JOURNAL_INVALID");
  return value;
}
/** A later draft may only recover the frozen request, never silently replace it. */
export function manualFinishDraftMatches(intent: ManualFinishIntent, payload: ManualFinishIntent["payload"]): boolean {
  return canonicalVoiceJson({ ...intent.payload, hand_time: null }) === canonicalVoiceJson({ ...payload, hand_time: null });
}
export function persistManualFinishJournal(storage: FinishStorage, key: string, intent: ManualFinishIntent): void {
  const serialized = canonicalVoiceJson(intent);
  const prior = storage.getItem(key);
  if (prior !== null && canonicalVoiceJson(JSON.parse(prior)) !== serialized) throw new Error("MANUAL_FINISH_JOURNAL_CHANGED");
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("MANUAL_FINISH_JOURNAL_WRITE_FAILED");
}
export function settleManualFinishJournal(storage: FinishStorage, key: string, intent: ManualFinishIntent): void {
  const prior = storage.getItem(key);
  if (prior === null || canonicalVoiceJson(JSON.parse(prior)) !== canonicalVoiceJson(intent)) throw new Error("MANUAL_FINISH_JOURNAL_CHANGED");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("MANUAL_FINISH_JOURNAL_SETTLE_FAILED");
}
