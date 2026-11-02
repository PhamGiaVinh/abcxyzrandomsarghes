import { canonicalVoiceJson } from "../trackerVoice/canonicalRequest";
import type { HistoricalSettlementDisplayPreview } from "./historicalSettlementDisplay";

export type HistoricalCommitIntent = {
  expected_actor_id: string; tournament_id: string; hand_id: string; idempotency_key: string;
  expected_source_revision: number; expected_source_chain_hash: string; expected_outcome_hash: string;
};
type Identity = Pick<HistoricalCommitIntent, "expected_actor_id" | "tournament_id" | "hand_id">;
type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function valid(value: unknown): value is HistoricalCommitIntent {
  return record(value) && Object.keys(value).length === 7 && uuid(value.expected_actor_id)
    && uuid(value.tournament_id) && uuid(value.hand_id) && typeof value.idempotency_key === "string"
    && value.idempotency_key.length >= 12 && value.idempotency_key.length <= 255
    && Number.isSafeInteger(value.expected_source_revision) && Number(value.expected_source_revision) >= 1
    && hash(value.expected_source_chain_hash) && hash(value.expected_outcome_hash);
}
export function historicalCommitKey(identity: Identity): string {
  return `vinpoker:historical-commit:v1:${identity.expected_actor_id}:${identity.tournament_id}:${identity.hand_id}`;
}
export function createHistoricalCommitIntent(actor: string, tournamentId: string, preview: HistoricalSettlementDisplayPreview): HistoricalCommitIntent {
  const intent = { expected_actor_id: actor, tournament_id: tournamentId, hand_id: preview.handId,
    idempotency_key: preview.idempotencyKey, expected_source_revision: preview.sourceRevision,
    expected_source_chain_hash: preview.sourceChainHash, expected_outcome_hash: preview.outcomeHash };
  if (!valid(intent)) throw new Error("HISTORICAL_COMMIT_INTENT_INVALID");
  return intent;
}
export function readHistoricalCommitJournal(storage: Pick<Storage, "getItem">, identity: Identity): HistoricalCommitIntent | null {
  const raw = storage.getItem(historicalCommitKey(identity));
  if (raw === null) return null;
  const intent: unknown = JSON.parse(raw);
  if (!valid(intent) || intent.expected_actor_id !== identity.expected_actor_id
    || intent.tournament_id !== identity.tournament_id || intent.hand_id !== identity.hand_id)
    throw new Error("HISTORICAL_COMMIT_JOURNAL_INVALID");
  return intent;
}
export function persistHistoricalCommitJournal(storage: JournalStorage, intent: HistoricalCommitIntent): void {
  if (!valid(intent)) throw new Error("HISTORICAL_COMMIT_INTENT_INVALID");
  const prior = readHistoricalCommitJournal(storage, intent);
  const serialized = canonicalVoiceJson(intent);
  if (prior && canonicalVoiceJson(prior) !== serialized) throw new Error("HISTORICAL_COMMIT_JOURNAL_CHANGED");
  const key = historicalCommitKey(intent);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("HISTORICAL_COMMIT_JOURNAL_WRITE_FAILED");
}
export function settleHistoricalCommitJournal(storage: JournalStorage, intent: HistoricalCommitIntent): void {
  const prior = readHistoricalCommitJournal(storage, intent);
  if (!prior || canonicalVoiceJson(prior) !== canonicalVoiceJson(intent)) throw new Error("HISTORICAL_COMMIT_JOURNAL_CHANGED");
  const key = historicalCommitKey(intent);
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("HISTORICAL_COMMIT_JOURNAL_SETTLE_FAILED");
}
function matchesIntent(value: unknown, intent: HistoricalCommitIntent): value is Record<string, unknown> {
  return record(value) && value.ok === true && value.actor_id === intent.expected_actor_id
    && value.tournament_id === intent.tournament_id && value.hand_id === intent.hand_id
    && value.idempotency_key === intent.idempotency_key && value.source_revision === intent.expected_source_revision
    && value.source_chain_hash === intent.expected_source_chain_hash && value.outcome_hash === intent.expected_outcome_hash;
}
/** A past commit receipt is not proof that its outcome is still public/current. */
export function historicalCommitReceiptState(value: unknown, intent: HistoricalCommitIntent): "found" | "not_found" | null {
  if (!matchesIntent(value, intent)) return null;
  if (value.status === "receipt_not_found" && value.receipt === null) return "not_found";
  const receipt = value.receipt;
  return value.status === "receipt_found" && record(receipt) && receipt.ok === true && receipt.idempotent === true
    && Number.isSafeInteger(receipt.settlement_revision) && Number(receipt.settlement_revision) >= 1
    && receipt.source_revision === intent.expected_source_revision && receipt.outcome_hash === intent.expected_outcome_hash ? "found" : null;
}

/** Only the serialized server resolution can prove a missing old request obsolete. */
export function historicalCommitResolutionState(value: unknown, intent: HistoricalCommitIntent): "found" | "not_found" | "obsolete" | null {
  if (!matchesIntent(value, intent) || !Number.isSafeInteger(value.current_source_revision)
    || Number(value.current_source_revision) < 1) return null;
  const receipt = historicalCommitReceiptState(value, intent);
  if (receipt === "found") return "found";
  if (receipt === "not_found" && Number(value.current_source_revision) <= intent.expected_source_revision) return "not_found";
  return value.status === "intent_obsolete" && value.receipt === null
    && Number(value.current_source_revision) > intent.expected_source_revision ? "obsolete" : null;
}
