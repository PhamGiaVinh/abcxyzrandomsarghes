import { supabase } from "@/integrations/supabase/client";
import { parseHistoricalSettlementDisplayPreview } from "./historicalSettlementDisplay";
import { parseReplayPublicSettlement } from "./replaySettlement";

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
}): Promise<RecordedHandDisplayOutcomeResult> {
  try {
    const readVerified = async () => {
      const { data, error } = await observeVerificationResponse(supabase.rpc(
        "get_public_tournament_settlement" as never,
        { p_hand_id: input.handId } as never,
      ));
      return !error && parseReplayPublicSettlement(data) !== null;
    };

    if (await readVerified()) return { ok: true, status: "already_verified" };

    const idempotencyKey = crypto.randomUUID();
    const { data: previewData, error: previewError } = await observeVerificationResponse(supabase.functions.invoke(
      "tournament-historical-settlement",
      { body: { mode: "preview", tournament_id: input.tournamentId, hand_id: input.handId } },
    ));
    if (previewError || (previewData as { ok?: boolean } | null)?.ok !== true) {
      return { ok: false, code: "preview_rejected" };
    }

    const preview = parseHistoricalSettlementDisplayPreview(previewData, idempotencyKey);
    if (!preview || preview.handId !== input.handId) return { ok: false, code: "invalid_preview" };

    const { data: commitData, error: commitError } = await observeVerificationResponse(supabase.functions.invoke(
      "tournament-historical-settlement",
      {
        body: {
          mode: "commit",
          tournament_id: input.tournamentId,
          hand_id: input.handId,
          idempotency_key: preview.idempotencyKey,
          expected_source_revision: preview.sourceRevision,
          expected_source_chain_hash: preview.sourceChainHash,
          expected_outcome_hash: preview.outcomeHash,
        },
      },
    ));

    if (commitError || (commitData as { ok?: boolean } | null)?.ok !== true) {
      // Re-read after a lost commit response; do not retry the commit. Public
      // proof is authoritative, not the transport outcome of this invocation.
      return await readVerified()
        ? { ok: true, status: "already_verified" }
        : { ok: false, code: "commit_rejected" };
    }

    return await readVerified()
      ? { ok: true, status: "verified" }
      : { ok: false, code: "verification_missing" };
  } catch {
    // Display verification must never turn an already committed poker hand into
    // a client-side submit failure or trigger a second record_hand attempt.
    return { ok: false, code: "verification_missing" };
  }
}
