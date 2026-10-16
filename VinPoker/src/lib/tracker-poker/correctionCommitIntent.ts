import { canonicalVoiceJson } from "../trackerVoice/canonicalRequest";
import type { HistoricalCommitIntent } from "./historicalCommitIntent";

export type CorrectionCommitIntent = HistoricalCommitIntent & { expected_request_hash: string };
export type CorrectionIdentity = Pick<CorrectionCommitIntent, "expected_actor_id" | "tournament_id" | "hand_id">;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validCorrectionIntent(v: unknown): v is CorrectionCommitIntent {
  return record(v) && Object.keys(v).length === 8 && uuid(v.expected_actor_id) && uuid(v.tournament_id) && uuid(v.hand_id)
    && typeof v.idempotency_key === "string" && v.idempotency_key.length >= 12 && v.idempotency_key.length <= 255
    && Number.isSafeInteger(v.expected_source_revision) && Number(v.expected_source_revision) >= 1
    && hash(v.expected_source_chain_hash) && hash(v.expected_outcome_hash) && hash(v.expected_request_hash);
}
export const correctionCommitKey = (v: CorrectionIdentity) => `vinpoker:correction-commit:v1:${v.expected_actor_id}:${v.tournament_id}:${v.hand_id}`;
export function readCorrectionIntent(store: Pick<Store, "getItem">, identity: CorrectionIdentity): CorrectionCommitIntent | null {
  const raw = store.getItem(correctionCommitKey(identity));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!validCorrectionIntent(value) || value.expected_actor_id !== identity.expected_actor_id
    || value.tournament_id !== identity.tournament_id || value.hand_id !== identity.hand_id) throw new Error("CORRECTION_JOURNAL_INVALID");
  return value;
}
export function persistCorrectionIntent(store: Store, intent: CorrectionCommitIntent): void {
  if (!validCorrectionIntent(intent)) throw new Error("CORRECTION_INTENT_INVALID");
  const prior = readCorrectionIntent(store, intent), raw = canonicalVoiceJson(intent);
  if (prior && canonicalVoiceJson(prior) !== raw) throw new Error("CORRECTION_JOURNAL_CHANGED");
  store.setItem(correctionCommitKey(intent), raw);
  if (store.getItem(correctionCommitKey(intent)) !== raw) throw new Error("CORRECTION_JOURNAL_WRITE_FAILED");
}
export function settleCorrectionIntent(store: Store, intent: CorrectionCommitIntent): void {
  const prior = readCorrectionIntent(store, intent);
  if (!prior || canonicalVoiceJson(prior) !== canonicalVoiceJson(intent)) throw new Error("CORRECTION_JOURNAL_CHANGED");
  store.removeItem(correctionCommitKey(intent));
  if (store.getItem(correctionCommitKey(intent)) !== null) throw new Error("CORRECTION_JOURNAL_SETTLE_FAILED");
}
export function correctionReceiptState(v: unknown, intent: CorrectionCommitIntent): "found" | "not_found" | null {
  if (!record(v) || v.ok !== true || v.actor_id !== intent.expected_actor_id || v.tournament_id !== intent.tournament_id
    || v.hand_id !== intent.hand_id || v.idempotency_key !== intent.idempotency_key || v.source_revision !== intent.expected_source_revision
    || v.source_chain_hash !== intent.expected_source_chain_hash || v.outcome_hash !== intent.expected_outcome_hash
    || v.request_hash !== intent.expected_request_hash) return null;
  if (v.status === "receipt_not_found" && v.receipt === null) return "not_found";
  const r = v.receipt;
  return v.status === "receipt_found" && record(r) && r.ok === true && r.idempotent === true
    && Number.isSafeInteger(r.settlement_revision) && Number(r.settlement_revision) >= 1
    && r.outcome_hash === intent.expected_outcome_hash ? "found" : null;
}
export function correctionResolutionState(v: unknown, intent: CorrectionCommitIntent): "found" | "not_found" | "obsolete" | null {
  if (!record(v) || !Number.isSafeInteger(v.current_source_revision) || Number(v.current_source_revision) < 1) return null;
  const state = correctionReceiptState(v, intent);
  if (state === "found") return state;
  if (state === "not_found" && Number(v.current_source_revision) <= intent.expected_source_revision) return state;
  // Reuse exact envelope validation; only serialized server resolution, never a
  // separate client read of revision, can make a missing old request terminal.
  if (v.status === "intent_obsolete" && v.receipt === null && Number(v.current_source_revision) > intent.expected_source_revision
    && correctionReceiptState({ ...v, status: "receipt_not_found" }, intent) === "not_found") return "obsolete";
  return null;
}
export function correctionCommitConfirmed(v: unknown, intent: CorrectionCommitIntent): boolean {
  if (!record(v) || v.ok !== true || v.status !== "verified" || v.hand_id !== intent.hand_id || !record(v.receipt)) return false;
  const r = v.receipt;
  return r.ok === true && r.correction_reason_recorded === true && r.outcome_hash === intent.expected_outcome_hash
    && Number.isSafeInteger(r.settlement_revision) && Number(r.settlement_revision) >= 1;
}
