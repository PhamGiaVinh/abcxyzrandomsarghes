import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResp } from "../_shared/cors.ts";
import {
  HistoricalDisplayVerificationError,
  verifyHistoricalDisplaySettlement,
} from "../_shared/trackerSettlement/historicalDisplayVerification.ts";
import { canonicalJsonV1 } from "../_shared/trackerSettlement/outcomeV1.ts";
import { isUuid } from "../_shared/internal-trigger-auth.ts";
import { authorizeHistoryWorker, HISTORY_CANARY_SECRET_ENV } from "../_shared/trackerSettlement/historyWorkerAuth.ts";
import {
  historicalWorkerFailureStatus,
  TRACKER_HISTORY_WORKER_MAX_BATCH,
  parseHistoryWorkerHandIds,
  requireHistoryCanaryScope,
  HISTORY_CANARY_SCOPE_ENV,
} from "../_shared/trackerSettlement/historyWorkerPolicy.ts";
import {
  normalizeSettlementSourceRpcResult,
  type SettlementDbAction,
  type SettlementDbHand,
  type SettlementDbPlayer,
} from "../_shared/trackerSettlement/compute.ts";

const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000001";

type ClaimedJob = { hand_id: string; source_revision: number; lease_token: string };

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResp(req, { ok: false, message: "Method not allowed" }, 405);
  const workerEnabled = Deno.env.get("TRACKER_HISTORY_COMPLETION_WORKER_ENABLED") === "true";
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authority = authorizeHistoryWorker(req, serviceKey, Deno.env.get(HISTORY_CANARY_SECRET_ENV));
  // A dark worker admits ONLY the separate credential; service-role remains disabled.
  if (!workerEnabled && (!authority.ok || !authority.scopedOnly)) {
    return jsonResp(req, { ok: false, code: "worker_disabled" }, 404);
  }
  if (!url || !serviceKey || !authority.ok) {
    return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
  }
  try {
    let parsed: unknown;
    try { parsed = await req.json(); }
    catch { return jsonResp(req, { ok: false, code: "invalid_worker_request" }, 400); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResp(req, { ok: false, code: "invalid_worker_request" }, 400);
    }
    const body = parsed as { limit?: unknown; hand_ids?: unknown };
    let handIds: string[] | undefined;
    try { handIds = parseHistoryWorkerHandIds(body.hand_ids); }
    catch { return jsonResp(req, { ok: false, code: "invalid_hand_scope" }, 400); }
    if (authority.scopedOnly && !handIds) {
      return jsonResp(req, { ok: false, code: "hand_scope_required" }, 400);
    }
    if (authority.scopedOnly && handIds) {
      try { requireHistoryCanaryScope(handIds, Deno.env.get(HISTORY_CANARY_SCOPE_ENV)); }
      catch (error) {
        return jsonResp(req, { ok: false, code: error instanceof Error ? error.message : "canary_scope_unavailable" }, 400);
      }
    }
    const limit = body.limit === undefined ? TRACKER_HISTORY_WORKER_MAX_BATCH : Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > TRACKER_HISTORY_WORKER_MAX_BATCH) {
      return jsonResp(req, { ok: false, code: "invalid_batch_limit" }, 400);
    }
    const service = createClient(url, serviceKey);
    const { data: claimed, error: claimError } = await service.rpc(handIds
      ? "claim_tracker_historical_display_jobs_scoped_v1" : "claim_tracker_historical_display_jobs", {
      p_limit: limit,
      ...(handIds ? { p_hand_ids: handIds } : {}),
    });
    if (claimError) throw claimError;
    if (!Array.isArray(claimed) || claimed.length > limit || claimed.some(job =>
      !job || !isUuid(job.hand_id) || !isUuid(job.lease_token)
      || !Number.isSafeInteger(job.source_revision) || job.source_revision < 1
      || (handIds && !handIds.includes(job.hand_id.toLowerCase())))) {
      throw new Error("historical_claim_unverified");
    }
    const jobs = claimed as ClaimedJob[];
    let completed = 0;
    let retried = 0;
    let needsAttention = 0;
    let unresolved = 0;

    for (const job of jobs) {
      try {
        const [snapshotResult, priorResult] = await Promise.all([
          service.rpc("get_tracker_historical_display_snapshot", { p_hand_id: job.hand_id, p_tournament_id: null }),
          service.from("tournament_settlement_outcomes").select("settlement_revision")
            .eq("hand_id", job.hand_id).order("settlement_revision", { ascending: false }).limit(1),
        ]);
        const dbError = snapshotResult.error || priorResult.error;
        if (dbError) throw dbError;
        if (!snapshotResult.data || typeof snapshotResult.data !== "object" || Array.isArray(snapshotResult.data)) {
          throw new HistoricalDisplayVerificationError("invalid_historical_hand");
        }
        const snapshot = snapshotResult.data as {
          hand?: SettlementDbHand; players?: SettlementDbPlayer[]; actions?: SettlementDbAction[];
          sourceRevision?: unknown; sourceChainHash?: unknown;
        };
        if (!snapshot.hand || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.actions)) {
          throw new HistoricalDisplayVerificationError("invalid_historical_hand");
        }
        const source = normalizeSettlementSourceRpcResult({
          source_revision: snapshot.sourceRevision, source_chain_hash: snapshot.sourceChainHash,
        });
        if (Number(snapshot.hand.source_revision) !== source.sourceRevision || source.sourceRevision !== job.source_revision) {
          throw new HistoricalDisplayVerificationError("stale_source_revision");
        }
        const settlementRevision = Number(priorResult.data?.[0]?.settlement_revision ?? 0) + 1;
        const result = await verifyHistoricalDisplaySettlement({
          tournamentId: snapshot.hand.tournament_id,
          hand: snapshot.hand,
          players: snapshot.players,
          actions: snapshot.actions,
          sourceRevision: source.sourceRevision,
          sourceChainHash: source.sourceChainHash,
          settlementRevision,
          actor: { userId: SYSTEM_ACTOR, role: "system_worker" },
        });
        const idempotencyKey = `history-worker:${job.hand_id}:${source.sourceRevision}:${settlementRevision}:${result.privateOutcome.outcomeHash}`;
        const requestHash = await hash(canonicalJsonV1({
          contract: "historical-settlement-display-worker-v1",
          handId: job.hand_id,
          sourceRevision: source.sourceRevision,
          sourceChainHash: source.sourceChainHash,
          settlementRevision,
          outcomeHash: result.privateOutcome.outcomeHash,
        }));
        const { data: receipt, error: commitError } = await service.rpc("commit_tracker_historical_display_outcome_v2", {
          p_hand_id: job.hand_id,
          p_actor_user_id: SYSTEM_ACTOR,
          p_actor_kind: "system_worker",
          p_expected_source_revision: source.sourceRevision,
          p_expected_source_chain_hash: source.sourceChainHash,
          p_outcome_hash: result.privateOutcome.outcomeHash,
          p_request_hash: requestHash,
          p_idempotency_key: idempotencyKey,
          p_public_outcome: result.publicOutcome,
          p_lease_token: job.lease_token,
        });
        if (commitError) throw commitError;
        if (receipt?.ok !== true || receipt.outcome_hash !== result.privateOutcome.outcomeHash
          || !Number.isSafeInteger(receipt.settlement_revision) || receipt.settlement_revision < 1) {
          throw new Error("worker_commit_response_unverified");
        }
        completed += 1;
      } catch (error) {
        const code = error instanceof HistoricalDisplayVerificationError
          ? error.code
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message).slice(0, 80)
            : "historical_worker_transient_failure";
        const status = historicalWorkerFailureStatus(code, error instanceof HistoricalDisplayVerificationError);
        const { data: finished, error: finishError } = await service.rpc("finish_tracker_historical_display_job", {
          p_hand_id: job.hand_id,
          p_source_revision: job.source_revision,
          p_lease_token: job.lease_token,
          p_status: status,
          p_error_code: code,
        });
        if (finishError) throw finishError;
        if (finished === true && status === "needs_attention") needsAttention += 1;
        if (finished === true && status === "pending") retried += 1;
        if (finished !== true) unresolved += 1;
      }
    }
    return jsonResp(req, { ok: unresolved === 0, claimed: jobs.length, completed, retried,
      needs_attention: needsAttention, unresolved }, unresolved === 0 ? 200 : 503);
  } catch {
    console.error("[tournament-historical-settlement-worker] batch_failed");
    return jsonResp(req, { ok: false, code: "worker_batch_failed" }, 503);
  }
});
