import type { PayoutRecipientPlace } from "@/hooks/useTournamentPayoutRecipients";

export type PrizePaymentIntent = Pick<PayoutRecipientPlace,
  "entryId" | "recipientRef" | "recipientName" | "finishedPlace" | "prizeAmount" | "confirmationToken" | "multiDayEventId" | "multiDayParticipationId"> & {
  actorId: string; tournamentId: string; requestId: string; method: string;
};
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const prizePaymentJournalKey = (actorId: string, tournamentId: string) => `vinpoker:prize-payment:v2:${actorId}:${tournamentId}`;
export function parsePrizePaymentIntent(raw: string, actorId: string, tournamentId: string): PrizePaymentIntent {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.actorId !== actorId || value.tournamentId !== tournamentId
    || !uuid(value.requestId) || !uuid(value.entryId) || !uuid(value.recipientRef)
    || typeof value.recipientName !== "string" || !value.recipientName.trim()
    || !Number.isSafeInteger(value.finishedPlace) || Number(value.finishedPlace) < 1
    || typeof value.prizeAmount !== "number" || !Number.isSafeInteger(value.prizeAmount) || value.prizeAmount < 0
    || typeof value.confirmationToken !== "string" || !/^[a-f0-9]{32}$/.test(value.confirmationToken)
    || typeof value.method !== "string" || !["cash", "bank", "app", "other"].includes(value.method)
    || ((value.multiDayEventId!==undefined||value.multiDayParticipationId!==undefined)
      &&(!uuid(value.multiDayEventId)||!uuid(value.multiDayParticipationId)))) {
    throw new Error("PAYOUT_JOURNAL_INVALID");
  }
  return value as PrizePaymentIntent;
}
export function prizePaymentPayload(intent: PrizePaymentIntent) {
  return { tournament_id: intent.tournamentId, finished_place: intent.finishedPlace,
    method: intent.method, expected_token: intent.confirmationToken,
    ...(intent.multiDayEventId?{event_id:intent.multiDayEventId,participation_id:intent.multiDayParticipationId}:{}) };
}
export type PrizePaymentResolution = { status: "unknown" } | { status: "rejected"; error: string }
  | { status: "committed"; outcome: "recorded" | "already_paid"; amount: number };
// Only established business rejections resolve a request. An unknown envelope
// must preserve the journal; it says nothing conclusive about an earlier send.
const resolvedRejections=new Set(['invalid_payment_intent','tournament_not_found','place_not_in_money',
  'place_not_finalized','place_ambiguous','prize_invalid','recipient_missing','payout_confirmation_stale',
  'paid_result_conflict','multi_day_obligations_not_finalized','multi_day_package_release_off','no_unpaid_obligation']);
export function resolvePrizePaymentResult(intent: PrizePaymentIntent, result: unknown): PrizePaymentResolution {
  if (!record(result)) return { status: "unknown" };
  if (result.ok === false && typeof result.error === "string" && result.error) {
    // These failures do not establish what happened to an earlier use of this
    // key. Preserve the journal for authorized receipt recovery.
    if (!resolvedRejections.has(result.error)) return { status: "unknown" };
    return { status: "rejected", error: result.error };
  }
  if (result.ok !== true || !["recorded", "already_paid"].includes(String(result.outcome))
    || !uuid(result.payment_id) || typeof result.paid_at !== "string" || !Number.isFinite(Date.parse(result.paid_at))
    || result.tournament_id !== intent.tournamentId || result.finished_place !== intent.finishedPlace
    || result.entry_id !== intent.entryId || result.recipient_ref !== intent.recipientRef
    || result.prize_amount !== intent.prizeAmount) return { status: "unknown" };
  return { status: "committed", outcome: result.outcome as "recorded" | "already_paid", amount: intent.prizeAmount };
}
export function resolvePrizePaymentReceipt(intent: PrizePaymentIntent, receipt: unknown): PrizePaymentResolution {
  if (!record(receipt) || receipt.found !== true || receipt.actor_id !== intent.actorId
    || receipt.request_id !== intent.requestId || !record(receipt.payload)) return { status: "unknown" };
  const payload = prizePaymentPayload(intent);
  const receivedPayload = receipt.payload;
  if (Object.keys(receivedPayload).length !== Object.keys(payload).length
    || Object.entries(payload).some(([key, value]) => receivedPayload[key] !== value)) return { status: "unknown" };
  return resolvePrizePaymentResult(intent, receipt.result);
}
export function persistPrizePaymentIntent(storage: Pick<Storage, "getItem" | "setItem">, intent: PrizePaymentIntent) {
  const key = prizePaymentJournalKey(intent.actorId, intent.tournamentId);
  const current = storage.getItem(key), raw = JSON.stringify(intent);
  if (current !== null && current !== raw) throw new Error("PAYOUT_JOURNAL_PENDING");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("PAYOUT_JOURNAL_SAVE_FAILED");
}
export function clearPrizePaymentIntent(storage: Pick<Storage, "getItem" | "removeItem">, intent: PrizePaymentIntent) {
  const key = prizePaymentJournalKey(intent.actorId, intent.tournamentId);
  const current = storage.getItem(key);
  if (current === null) return;
  if (current !== JSON.stringify(intent)) throw new Error("PAYOUT_JOURNAL_CHANGED");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("PAYOUT_JOURNAL_CLEAR_FAILED");
}
