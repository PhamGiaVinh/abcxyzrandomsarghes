import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResp } from "../_shared/cors.ts";
import {
  HistoricalDisplayVerificationError,
  verifyHistoricalDisplaySettlement,
} from "../_shared/trackerSettlement/historicalDisplayVerification.ts";
import { canonicalJsonV1 } from "../_shared/trackerSettlement/outcomeV1.ts";
import { normalizeSettlementSourceRpcResult, type SettlementDbAction, type SettlementDbHand, type SettlementDbPlayer } from "../_shared/trackerSettlement/compute.ts";

type Body = {
  mode?: "preview" | "commit" | "correct_blinds" | "receipt";
  expected_actor_id?: string;
  tournament_id?: string;
  hand_id?: string;
  idempotency_key?: string;
  expected_source_revision?: number;
  expected_source_chain_hash?: string;
  expected_outcome_hash?: string;
  blind_level_id?: string;
  blind_level_number?: number;
  blind_small_blind?: number;
  blind_big_blind?: number;
  blind_ante?: number;
  correction_reason?: string;
  correction_evidence?: Record<string, unknown>;
};

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicFailure(req: Request, code: string, status = 409) {
  return jsonResp(req, { ok: false, code, message: "Historical display verification was not accepted" }, status);
}

function rpcFailureCode(error: { message?: string } | null): string {
  const allowed = new Set([
    "service_role_only",
    "idempotency_mismatch",
    "stale_source_revision",
    "historical_settlement_already_exists",
    "actor_not_authorized",
    "invalid_historical_hand",
    "historical_player_projection_mismatch",
    "blind_snapshot_already_present",
    "blind_snapshot_conflict",
    "invalid_tournament_level_snapshot",
    "invalid_blind_correction_request",
    "stale_source_revision",
    "tracker_blind_snapshot_server_owned",
  ]);
  return error?.message && allowed.has(error.message) ? error.message : "historical_display_commit_rejected";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResp(req, { ok: false, message: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);

  try {
    const body = await req.json() as Body;
    const mode = body.mode;
    const tournamentId = text(body.tournament_id);
    const handId = text(body.hand_id);
    if ((mode !== "preview" && mode !== "commit" && mode !== "correct_blinds" && mode !== "receipt") || !tournamentId || !handId) {
      return jsonResp(req, { ok: false, message: "Invalid historical settlement intent" }, 400);
    }
    if ((mode === "commit" || mode === "receipt") && text(body.idempotency_key).length < 12) {
      return publicFailure(req, "invalid_idempotency_key", 400);
    }
    const hasPreviewFingerprint = Number.isSafeInteger(body.expected_source_revision)
      && (body.expected_source_revision ?? 0) >= 1
      && /^[0-9a-f]{64}$/.test(text(body.expected_source_chain_hash))
      && /^[0-9a-f]{64}$/.test(text(body.expected_outcome_hash));
    if (mode === "receipt" && (!hasPreviewFingerprint || !text(body.expected_actor_id))) {
      return publicFailure(req, "invalid_receipt_intent", 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("historical_settlement_runtime_not_configured");

    const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    let authentication: Awaited<ReturnType<typeof user.auth.getUser>>;
    try { authentication = await user.auth.getUser(); }
    catch { return jsonResp(req, { ok: false, code: "authentication_unavailable", message: "Authentication unavailable" }, 503); }
    if (authentication.error) {
      const unavailable = ![400, 401, 403, 422].includes(authentication.error.status ?? 0);
      return jsonResp(req, { ok: false, code: unavailable ? "authentication_unavailable" : "unauthorized",
        message: unavailable ? "Authentication unavailable" : "Unauthorized" }, unavailable ? 503 : 401);
    }
    const authData = authentication.data;
    if (!authData?.user) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
    if (body.expected_actor_id !== undefined && body.expected_actor_id !== authData.user.id) {
      return publicFailure(req, "actor_context_changed", 409);
    }
    try {
      const { data: authorized, error: authorizationError } = await user.rpc("authorize_tournament_live_resettle", {
        p_tournament_id: tournamentId,
      });
      if (authorizationError) return jsonResp(req, { ok: false, code: "authorization_unavailable", message: "Authorization unavailable" }, 503);
      if (authorized === false) return jsonResp(req, { ok: false, message: "Not authorized" }, 403);
      if (authorized !== true) return jsonResp(req, { ok: false, code: "authorization_unavailable", message: "Authorization unavailable" }, 503);
    } catch { return jsonResp(req, { ok: false, code: "authorization_unavailable", message: "Authorization unavailable" }, 503); }

    const service = createClient(url, serviceKey);
    if (mode === "correct_blinds") {
      if (!Number.isSafeInteger(body.expected_source_revision)
        || !text(body.blind_level_id) || text(body.correction_reason).length < 8
        || !Number.isSafeInteger(body.blind_level_number) || (body.blind_level_number ?? 0) < 1
        || !Number.isSafeInteger(body.blind_small_blind) || (body.blind_small_blind ?? 0) <= 0
        || !Number.isSafeInteger(body.blind_big_blind) || (body.blind_big_blind ?? 0) < (body.blind_small_blind ?? 0)
        || !Number.isSafeInteger(body.blind_ante) || (body.blind_ante ?? -1) < 0
        || text(body.idempotency_key).length < 12
        || !body.correction_evidence || typeof body.correction_evidence !== "object"
        || Array.isArray(body.correction_evidence) || Object.keys(body.correction_evidence).length === 0) {
        return publicFailure(req, "invalid_blind_correction_request", 400);
      }
      const { data: correction, error: correctionError } = await service.rpc("correct_tracker_historical_hand_blinds", {
        p_hand_id: handId,
        p_actor_user_id: authData.user.id,
        p_expected_source_revision: body.expected_source_revision,
        p_level_id: text(body.blind_level_id),
        p_level_number: body.blind_level_number,
        p_small_blind: body.blind_small_blind,
        p_big_blind: body.blind_big_blind,
        p_ante: body.blind_ante,
        p_reason: text(body.correction_reason),
        p_idempotency_key: text(body.idempotency_key),
        p_evidence: body.correction_evidence,
      });
      if (correctionError) return publicFailure(req, rpcFailureCode(correctionError));
      if (correction?.status === "needs_attention") {
        return jsonResp(req, { ok: false, status: "needs_attention", code: "blind_snapshot_conflict", hand_id: handId }, 409);
      }
      return jsonResp(req, { ok: true, status: "corrected", hand_id: handId, receipt: correction });
    }
    if ((mode === "commit" && hasPreviewFingerprint) || mode === "receipt") {
      const { data: priorReceipt, error: priorReceiptError } = await service.rpc(
        "get_tracker_historical_display_commit_receipt",
        {
          p_hand_id: handId,
          p_tournament_id: tournamentId,
          p_actor_user_id: authData.user.id,
          p_idempotency_key: text(body.idempotency_key),
          p_expected_source_revision: body.expected_source_revision,
          p_expected_source_chain_hash: text(body.expected_source_chain_hash),
          p_expected_outcome_hash: text(body.expected_outcome_hash),
        },
      );
      if (priorReceiptError) return mode === "receipt" && priorReceiptError.message !== "idempotency_mismatch"
        ? publicFailure(req, "receipt_read_unavailable", 503) : publicFailure(req, rpcFailureCode(priorReceiptError));
      if (mode === "receipt" && priorReceipt !== null && (!priorReceipt || typeof priorReceipt !== "object"
        || priorReceipt.ok !== true || priorReceipt.idempotent !== true
        || !Number.isSafeInteger(priorReceipt.settlement_revision) || priorReceipt.settlement_revision < 1
        || priorReceipt.source_revision !== body.expected_source_revision
        || priorReceipt.outcome_hash !== text(body.expected_outcome_hash))) {
        return publicFailure(req, "historical_receipt_unconfirmed", 502);
      }
      if (mode === "receipt") return jsonResp(req, {
        ok: true, status: priorReceipt ? "receipt_found" : "receipt_not_found",
        actor_id: authData.user.id, tournament_id: tournamentId, hand_id: handId,
        idempotency_key: text(body.idempotency_key), source_revision: body.expected_source_revision,
        source_chain_hash: text(body.expected_source_chain_hash), outcome_hash: text(body.expected_outcome_hash),
        receipt: priorReceipt,
      });
      if (priorReceipt) return jsonResp(req, { ok: true, status: "verified", hand_id: handId, receipt: priorReceipt });
    }
    const [{ data: snapshotData, error: snapshotError }, { data: priorOutcomes, error: priorOutcomeError }] = await Promise.all([
      service.rpc("get_tracker_historical_display_snapshot", { p_hand_id: handId, p_tournament_id: tournamentId }),
      service.from("tournament_settlement_outcomes").select("settlement_revision")
        .eq("hand_id", handId).order("settlement_revision", { ascending: false }).limit(1),
    ]);
    if (snapshotError || priorOutcomeError) throw snapshotError || priorOutcomeError;
    if (!snapshotData || typeof snapshotData !== "object" || Array.isArray(snapshotData)) return publicFailure(req, "historical_hand_not_found", 404);
    const snapshot = snapshotData as { hand?: SettlementDbHand; players?: SettlementDbPlayer[]; actions?: SettlementDbAction[]; sourceRevision?: unknown; sourceChainHash?: unknown };
    if (!snapshot.hand || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.actions)) return publicFailure(req, "historical_hand_not_found", 404);
    const settlementSource = normalizeSettlementSourceRpcResult({
      source_revision: snapshot.sourceRevision, source_chain_hash: snapshot.sourceChainHash,
    });
    if (Number(snapshot.hand.source_revision) !== settlementSource.sourceRevision) return publicFailure(req, "stale_source_revision");
    const result = await verifyHistoricalDisplaySettlement({
      tournamentId,
      hand: snapshot.hand,
      players: snapshot.players,
      actions: snapshot.actions,
      sourceRevision: settlementSource.sourceRevision,
      sourceChainHash: settlementSource.sourceChainHash,
      settlementRevision: Number(priorOutcomes?.[0]?.settlement_revision ?? 0) + 1,
      actor: { userId: authData.user.id, role: "club_owner_or_admin" },
    });

    const preview = {
      ok: true,
      status: "preview",
      hand_id: handId,
      source_revision: result.privateOutcome.sourceRevision,
      source_chain_hash: result.privateOutcome.sourceChainHash,
      outcome_hash: result.privateOutcome.outcomeHash,
      public_outcome: result.publicOutcome,
    };
    if (mode === "preview") return jsonResp(req, preview);

    if (body.expected_source_revision !== preview.source_revision
      || body.expected_source_chain_hash !== preview.source_chain_hash
      || body.expected_outcome_hash !== preview.outcome_hash) {
      return publicFailure(req, "stale_historical_preview");
    }

    const requestHash = await sha256Hex(canonicalJsonV1({
      contract: "historical-settlement-display-v1",
      tournamentId,
      handId,
      sourceRevision: preview.source_revision,
      sourceChainHash: preview.source_chain_hash,
      outcomeHash: preview.outcome_hash,
    }));
    const { data: receipt, error: commitError } = await service.rpc(
      "commit_tracker_historical_display_outcome_v2",
      {
        p_hand_id: handId,
        p_actor_user_id: authData.user.id,
        p_actor_kind: "owner_admin",
        p_expected_source_revision: preview.source_revision,
        p_expected_source_chain_hash: preview.source_chain_hash,
        p_outcome_hash: preview.outcome_hash,
        p_request_hash: requestHash,
        p_idempotency_key: text(body.idempotency_key),
        p_public_outcome: result.publicOutcome,
        p_lease_token: null,
      },
    );
    if (commitError) return publicFailure(req, rpcFailureCode(commitError));
    return jsonResp(req, { ok: true, status: "verified", hand_id: handId, receipt });
  } catch (error) {
    if (error instanceof HistoricalDisplayVerificationError) return publicFailure(req, error.code, 422);
    console.error("[tournament-historical-settlement] unexpected_request_failure");
    return jsonResp(req, { ok: false, message: "Historical display verification failed" }, 500);
  }
});
