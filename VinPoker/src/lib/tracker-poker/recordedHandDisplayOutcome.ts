import { supabase } from "@/integrations/supabase/client";
import { parseHistoricalSettlementDisplayPreview } from "./historicalSettlementDisplay";
import { parseReplayPublicSettlement } from "./replaySettlement";
import { createHistoricalCommitIntent, historicalCommitReceiptState, persistHistoricalCommitJournal,
  readHistoricalCommitJournal, settleHistoricalCommitJournal, type HistoricalCommitIntent } from "./historicalCommitIntent";

export type RecordedHandDisplayOutcomeResult =
  | { ok: true; status: "already_verified" | "verified" }
  | { ok: false; code: "preview_rejected" | "invalid_preview" | "commit_rejected" | "verification_missing" };

/** Stop observing a stalled verification step, without retrying its server operation.
 * A timed-out commit may still finish on the server: it is not a failed hand or
 * permission to send another commit. Late responses cannot advance this pipeline.
 */
async function observeVerificationResponse<T>(response: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(response),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("display_verification_response_timeout")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates the display-only settlement proof for a canonical hand that the
 * server has already recorded. The browser never supplies winners, cards,
 * stacks or payout amounts: the existing Edge verifier reloads and proves all
 * of them before its idempotent commit.
 */
export async function ensureRecordedHandDisplayOutcome(input: {
  tournamentId: string;
  handId: string;
  actorId: string;
  isCurrent: () => boolean;
}): Promise<RecordedHandDisplayOutcomeResult> {
  try {
    const current = () => input.isCurrent();
    if (!current()) return { ok: false, code: "verification_missing" };
    const identity = { expected_actor_id: input.actorId, tournament_id: input.tournamentId, hand_id: input.handId };
    const readVerified = async () => {
      if (!current()) return false;
      const { data, error } = await observeVerificationResponse(supabase.rpc(
        "get_public_tournament_settlement" as never,
        { p_hand_id: input.handId } as never,
      ));
      if (error) throw new Error("historical_public_proof_read_unavailable");
      return current() && parseReplayPublicSettlement(data) !== null;
    };

    const recover = async (intent: HistoricalCommitIntent): Promise<RecordedHandDisplayOutcomeResult> => {
      if (!current()) return { ok: false, code: "verification_missing" };
      const { data, error } = await observeVerificationResponse(supabase.functions.invoke(
        "tournament-historical-settlement", { body: { mode: "receipt", ...intent } },
      ));
      if (!current() || error || historicalCommitReceiptState(data, intent) !== "found")
        return { ok: false, code: "verification_missing" };
      // Receipt proves this request committed, not that its proof is still current.
      // Cleanup failure must not discard or replace an unresolved journal.
      try { settleHistoricalCommitJournal(sessionStorage, intent); } catch { /* retain for explicit recovery */ }
      return await readVerified() ? { ok: true, status: "verified" } : { ok: false, code: "verification_missing" };
    };
    const pending = readHistoricalCommitJournal(sessionStorage, identity);
    if (pending) return await recover(pending);

    if (await readVerified()) return { ok: true, status: "already_verified" };
    if (!current()) return { ok: false, code: "verification_missing" };

    const idempotencyKey = crypto.randomUUID();
    const { data: previewData, error: previewError } = await observeVerificationResponse(supabase.functions.invoke(
      "tournament-historical-settlement",
      { body: { mode: "preview", tournament_id: input.tournamentId, hand_id: input.handId } },
    ));
    if (!current()) return { ok: false, code: "verification_missing" };
    if (previewError || (previewData as { ok?: boolean } | null)?.ok !== true) {
      return { ok: false, code: "preview_rejected" };
    }

    const preview = parseHistoricalSettlementDisplayPreview(previewData, idempotencyKey);
    if (!preview || preview.handId !== input.handId) return { ok: false, code: "invalid_preview" };
    const intent = createHistoricalCommitIntent(input.actorId, input.tournamentId, preview);
    // Read back durable metadata before issuing the writer. A competing request
    // cannot replace a different journal while this preview was in flight.
    persistHistoricalCommitJournal(sessionStorage, intent);
    if (!current()) return { ok: false, code: "verification_missing" };
    try { await observeVerificationResponse(supabase.functions.invoke(
      "tournament-historical-settlement",
      {
        body: {
          mode: "commit",
          ...intent,
        },
      },
    )); } catch { /* Unknown commit: read the same receipt, never retry the writer. */ }
    return await recover(intent);
  } catch {
    // Display verification must never turn an already committed poker hand into
    // a client-side submit failure or trigger a second record_hand attempt.
    return { ok: false, code: "verification_missing" };
  }
}
