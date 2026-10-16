import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResp } from "../_shared/cors.ts";
import {
  computeAuthoritativeSettlement,
  normalizeSettlementSourceRpcResult,
  type SettlementDbAction,
  type SettlementDbHand,
  type SettlementDbPlayer,
  type SettlementEdit,
} from "../_shared/trackerSettlement/compute.ts";
import {
  assertExpectedTargetEndingStacks,
  redactedTargetEndingStacks,
  type ExpectedTargetEndingStack,
} from "../_shared/trackerSettlement/expectedEndingStacks.ts";
import { canonicalJsonV1 } from "../_shared/trackerSettlement/outcomeV1.ts";

type Body = {
  mode?: unknown;
  tournament_id?: unknown;
  hand_id?: unknown;
  idempotency_key?: unknown;
  correction_reason?: unknown;
  expected_target_ending_stacks?: unknown;
  edit?: unknown;
  expected_source_revision?: unknown;
  expected_source_chain_hash?: unknown;
  expected_outcome_hash?: unknown;
};

type RecordValue = Record<string, unknown>;

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const isChip = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isEntry = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const CARD = /^(?:[2-9TJQKA][cdhs])$/;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicFailure(
  req: Request,
  code: string,
  status = 409,
  draftStatus?: "INCOMPLETE" | "INVALID",
) {
  return jsonResp(req, {
    ok: false,
    code,
    ...(draftStatus ? { draft_status: draftStatus } : {}),
    message: "Hand correction was not accepted",
  }, status);
}

function parseCards(value: unknown, maximum: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximum || !value.every((card) => typeof card === "string" && CARD.test(card))) {
    return null;
  }
  return [...value];
}

function parseEdit(value: unknown): SettlementEdit | null {
  if (!isRecord(value)) return null;
  const edit: SettlementEdit = {};
  let hasEdit = false;

  if ("communityCards" in value) {
    const cards = parseCards(value.communityCards, 5);
    if (!cards) return null;
    edit.communityCards = cards;
    hasEdit = true;
  }
  if ("holeCards" in value) {
    if (!Array.isArray(value.holeCards)) return null;
    const holes: NonNullable<SettlementEdit["holeCards"]> = [];
    for (const row of value.holeCards) {
      if (!isRecord(row)) return null;
      const cards = parseCards(row.hole_cards, 2);
      const playerId = text(row.player_id);
      if (!playerId || !cards || ("entry_number" in row && !isEntry(row.entry_number))) return null;
      holes.push({ player_id: playerId, entry_number: row.entry_number as number | undefined, hole_cards: cards });
    }
    edit.holeCards = holes;
    hasEdit = true;
  }
  if ("actions" in value) {
    if (!Array.isArray(value.actions)) return null;
    const actions: SettlementDbAction[] = [];
    for (const row of value.actions) {
      if (!isRecord(row)) return null;
      const playerId = text(row.player_id);
      const street = text(row.street);
      const actionType = text(row.action_type);
      if (!playerId || !street || !actionType || !isEntry(row.entry_number) || !isChip(row.action_amount) || !isEntry(row.action_order)) {
        return null;
      }
      actions.push({
        hand_id: "",
        player_id: playerId,
        entry_number: row.entry_number,
        street,
        action_type: actionType,
        action_amount: row.action_amount,
        action_order: row.action_order,
      });
    }
    edit.actions = actions;
    hasEdit = true;
  }
  return hasEdit ? edit : null;
}

function parseExpectedTargetEndingStacks(value: unknown): ExpectedTargetEndingStack[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ExpectedTargetEndingStack[] = [];
  for (const row of value) {
    if (!isRecord(row)) return null;
    const playerId = text(row.player_id);
    if (!playerId || !isEntry(row.entry_number) || !isChip(row.ending_stack)) return null;
    rows.push({ player_id: playerId, entry_number: row.entry_number, ending_stack: row.ending_stack });
  }
  return rows;
}

function computeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("edited_action_invalid:")) return "invalid_edited_action";
  if (message.startsWith("expected_target_stack_")) return message;
  if (message === "bust_state_change_requires_void") return message;
  if (message === "reentry_boundary") return message;
  if (message === "invalid_chain_state") return message;
  return "settlement_recompute_rejected";
}

function computeFailureDraftStatus(error: unknown): "INCOMPLETE" | "INVALID" {
  const message = error instanceof Error ? error.message : "";
  return message.includes("incomplete") || message.includes("not_terminal")
    ? "INCOMPLETE"
    : "INVALID";
}

function rpcFailureCode(error: { message?: string } | null): string {
  const allowed = new Set([
    "service_role_only",
    "idempotency_mismatch",
    "stale_source_revision",
    "stale_live_stack",
    "active_hand_blocks_resettle",
    "actor_not_authorized",
    "invalid_correction_reason",
    "invalid_target_hand",
    "outcome_hash_mismatch",
  ]);
  return error?.message && allowed.has(error.message) ? error.message : "hand_correction_commit_rejected";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResp(req, { ok: false, message: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);

  try {
    const body = await req.json() as Body;
    const mode = text(body.mode);
    const tournamentId = text(body.tournament_id);
    const handId = text(body.hand_id);
    const idempotencyKey = text(body.idempotency_key);
    const correctionReason = text(body.correction_reason);
    const edit = parseEdit(body.edit);
    const expectedEndingStacks = parseExpectedTargetEndingStacks(body.expected_target_ending_stacks);
    if ((mode !== "preview" && mode !== "commit") || !tournamentId || !handId
      || (mode === "commit" && idempotencyKey.length < 12)
      || correctionReason.length < 8 || correctionReason.length > 500 || !edit || !expectedEndingStacks) {
      return publicFailure(req, "invalid_hand_correction_intent", 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("hand_correction_runtime_not_configured");

    const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    let authentication: Awaited<ReturnType<typeof user.auth.getUser>>;
    try { authentication = await user.auth.getUser(); }
    catch { return publicFailure(req, "authentication_unavailable", 503); }
    if (authentication.error) {
      const unavailable = ![400, 401, 403, 422].includes(authentication.error.status ?? 0);
      return publicFailure(req, unavailable ? "authentication_unavailable" : "unauthorized", unavailable ? 503 : 401);
    }
    const authData = authentication.data;
    if (!authData?.user) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
    let authorizationReceipt: RecordValue | null;
    try {
      const { data, error } = await user.rpc("authorize_tracker_completed_hand_correction_uat_v1", {
        p_tournament_id: tournamentId, p_hand_id: handId,
      });
      if (error) return publicFailure(req, "authorization_unavailable", 503);
      authorizationReceipt = isRecord(data) ? data : null;
    } catch { return publicFailure(req, "authorization_unavailable", 503); }
    if (!authorizationReceipt || typeof authorizationReceipt.ok !== "boolean") {
      return publicFailure(req, "authorization_unavailable", 503);
    }
    if (authorizationReceipt.ok !== true) {
      return publicFailure(req, text(authorizationReceipt?.error) || "actor_not_authorized", 403);
    }

    const service = createClient(url, serviceKey);
    const { data: hands, error: handError } = await service.from("tournament_hands")
      .select("id,tournament_id,hand_number,table_id,button_seat,community_cards,pot_size,side_pots,status,is_voided,updated_at,created_at,source_revision")
      .eq("tournament_id", tournamentId).eq("is_voided", false).order("hand_number").order("id");
    if (handError) throw handError;
    const allHands = (hands ?? []) as SettlementDbHand[];
    const targetIndex = allHands.findIndex((hand) => hand.id === handId);
    if (targetIndex < 0) return publicFailure(req, "target_hand_not_found", 404);
    const chain = allHands.slice(targetIndex);
    const ids = chain.map((hand) => hand.id);
    const [{ data: players, error: playerError }, { data: actions, error: actionError }, { data: liveStacks, error: stackError }, { data: source, error: sourceError }, { data: priorOutcome, error: outcomeError }] = await Promise.all([
      service.from("hand_players").select("hand_id,player_id,entry_number,seat_number,starting_stack,ending_stack,hole_cards,is_eliminated").in("hand_id", ids),
      service.from("hand_actions").select("id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order").in("hand_id", ids).order("action_order").order("id"),
      service.from("tournament_chip_counts").select("player_id,entry_number,chip_count").eq("tournament_id", tournamentId),
      service.rpc("get_tournament_settlement_source_hash", { p_hand_id: handId }),
      service.from("tournament_settlement_outcomes").select("settlement_revision").eq("hand_id", handId).order("settlement_revision", { ascending: false }).limit(1),
    ]);
    if (playerError || actionError || stackError || sourceError || outcomeError) throw playerError || actionError || stackError || sourceError || outcomeError;
    const settlementSource = normalizeSettlementSourceRpcResult(source);
    const priorRevision = Number((priorOutcome ?? [])[0]?.settlement_revision ?? 0);
    if (!Number.isSafeInteger(priorRevision) || priorRevision < 0) throw new Error("invalid_prior_settlement_revision");

    let result;
    try {
      result = await computeAuthoritativeSettlement({
        tournamentId,
        targetHandId: handId,
        hands: chain,
        players: (players ?? []) as SettlementDbPlayer[],
        actions: (actions ?? []) as SettlementDbAction[],
        liveStacks: (liveStacks ?? []) as { player_id: string; entry_number: number; chip_count: number }[],
        edit,
        actor: { userId: authData.user.id, role: "club_owner_or_admin" },
        sourceRevisionOverride: settlementSource.sourceRevision,
        sourceChainHashOverride: settlementSource.sourceChainHash,
        settlementRevisionOverride: priorRevision + 1,
      });
      const targetPlayers = (players ?? [])
        .filter((player: SettlementDbPlayer) => player.hand_id === handId)
        .map((player: SettlementDbPlayer) => ({
          player_id: player.player_id,
          entry_number: player.entry_number,
          starting_stack: player.starting_stack,
        }));
      assertExpectedTargetEndingStacks({ expected: expectedEndingStacks, targetPlayers, outcome: result.privateOutcome });

      const preview = {
        ok: true,
        status: "preview",
        draft_status: "READY_TO_APPLY",
        hand_id: handId,
        scope: text(authorizationReceipt.scope),
        source_revision: result.privateOutcome.sourceRevision,
        source_chain_hash: result.privateOutcome.sourceChainHash,
        outcome_hash: result.privateOutcome.outcomeHash,
        public_outcome: result.publicOutcome,
        target_ending_stacks: redactedTargetEndingStacks({ targetPlayers, outcome: result.privateOutcome }),
      };
      if (mode === "preview") return jsonResp(req, preview);
      if (body.expected_source_revision !== preview.source_revision
        || body.expected_source_chain_hash !== preview.source_chain_hash
        || body.expected_outcome_hash !== preview.outcome_hash) {
        return publicFailure(req, "stale_correction_preview");
      }

      const requestHash = await sha256Hex(canonicalJsonV1({
        contract: "tracker-hand-correction-commit-v1",
        tournamentId,
        handId,
        actorUserId: authData.user.id,
        sourceRevision: result.privateOutcome.sourceRevision,
        sourceChainHash: result.privateOutcome.sourceChainHash,
        outcomeHash: result.privateOutcome.outcomeHash,
        correctionReason,
        expectedEndingStacks,
        edit: result.persistedEdit,
      }));
      const { data: receipt, error: commitError } = await service.rpc("commit_tracker_hand_correction_outcome", {
        p_hand_id: handId,
        p_actor_user_id: authData.user.id,
        p_expected_source_revision: result.privateOutcome.sourceRevision,
        p_expected_source_chain_hash: result.privateOutcome.sourceChainHash,
        p_settlement_revision: result.privateOutcome.settlementRevision,
        p_outcome_hash: result.privateOutcome.outcomeHash,
        p_request_hash: requestHash,
        p_idempotency_key: idempotencyKey,
        p_public_outcome: result.publicOutcome,
        p_edit: result.persistedEdit,
        p_hand_changes: result.handChanges,
        p_final_stacks: result.finalStacks,
        p_correction_reason: correctionReason,
      });
      if (commitError) return publicFailure(req, rpcFailureCode(commitError));
      return jsonResp(req, {
        ok: true,
        status: "verified",
        hand_id: handId,
        receipt,
        public_outcome: result.publicOutcome,
        target_ending_stacks: redactedTargetEndingStacks({ targetPlayers, outcome: result.privateOutcome }),
      });
    } catch (error) {
      return publicFailure(req, computeFailureCode(error), 422, computeFailureDraftStatus(error));
    }
  } catch {
    console.error("[tournament-live-resettle-commit] unexpected_request_failure");
    return jsonResp(req, { ok: false, message: "Hand correction failed" }, 500);
  }
});
