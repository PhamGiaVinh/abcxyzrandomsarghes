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

type Body = {
  mode?: "preview" | "commit";
  tournament_id?: string;
  hand_id?: string;
  idempotency_key?: string;
  expected_source_revision?: number;
  expected_source_chain_hash?: string;
  expected_outcome_hash?: string;
  edit?: SettlementEdit;
};

const text = (value: unknown) => typeof value === "string" ? value : "";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResp(req, { ok: false, message: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);

  try {
    const body = await req.json() as Body;
    const tournamentId = text(body.tournament_id);
    const handId = text(body.hand_id);
    const mode = body.mode;
    if (!tournamentId || !handId || (mode !== "preview" && mode !== "commit")) {
      return jsonResp(req, { ok: false, message: "Invalid settlement intent" }, 400);
    }
    // This legacy route is intentionally preview-only until the dedicated
    // settlement commit route is deployed and owner-gated.
    if (mode === "commit") {
      return jsonResp(req, { ok: false, code: "LEGACY_COMMIT_DISABLED", message: "Commit requires the owner-gated settlement route" }, 409);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("settlement_runtime_not_configured");
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
    const { data: authorized, error: authError } = await userClient.rpc("authorize_tournament_live_resettle", { p_tournament_id: tournamentId });
    if (authError || authorized !== true) return jsonResp(req, { ok: false, message: "Not authorized" }, 403);

    const service = createClient(url, serviceKey);
    const { data: hands, error: handError } = await service.from("tournament_hands")
      .select("*")
      .eq("tournament_id", tournamentId).eq("is_voided", false).order("hand_number").order("id");
    if (handError) throw handError;
    const allHands = (hands ?? []) as (SettlementDbHand & { source_revision?: number })[];
    const targetIndex = allHands.findIndex((hand) => hand.id === handId);
    if (targetIndex < 0) return jsonResp(req, { ok: false, message: "Target hand not found" }, 404);
    const chain = allHands.slice(targetIndex);
    const ids = chain.map((hand) => hand.id);
    const [{ data: players, error: playerError }, { data: actions, error: actionError }, { data: liveStacks, error: stackError }, { data: source, error: sourceError }] = await Promise.all([
      service.from("hand_players").select("hand_id,player_id,entry_number,seat_number,starting_stack,ending_stack,hole_cards,is_eliminated").in("hand_id", ids),
      service.from("hand_actions").select("id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order").in("hand_id", ids).order("action_order").order("id"),
      service.from("tournament_chip_counts").select("player_id,entry_number,chip_count").eq("tournament_id", tournamentId),
      service.rpc("get_tournament_settlement_source_hash", { p_hand_id: handId }),
    ]);
    if (playerError || actionError || stackError || sourceError) throw playerError || actionError || stackError || sourceError;
    const settlementSource = normalizeSettlementSourceRpcResult(source);

    const result = await computeAuthoritativeSettlement({
      tournamentId,
      targetHandId: handId,
      hands: chain,
      players: (players ?? []) as SettlementDbPlayer[],
      actions: (actions ?? []) as SettlementDbAction[],
      liveStacks: (liveStacks ?? []) as { player_id: string; entry_number: number; chip_count: number }[],
      edit: body.edit,
      actor: { userId: authData.user.id, role: "club_owner_or_admin" },
      sourceRevisionOverride: settlementSource.sourceRevision,
      sourceChainHashOverride: settlementSource.sourceChainHash,
    });
    const preview = {
      ok: true,
      status: "preview",
      source_revision: result.privateOutcome.sourceRevision,
      source_chain_hash: result.privateOutcome.sourceChainHash,
      outcome_hash: result.privateOutcome.outcomeHash,
      public_outcome: result.publicOutcome,
      affected_hand_count: result.affectedHandCount,
      affected_player_count: result.affectedPlayerCount,
    };
    return jsonResp(req, preview);
  } catch (error) {
    console.error("[tournament-live-resettle]", error instanceof Error ? error.message : "unknown_error");
    return jsonResp(req, { ok: false, message: "Settlement request failed" }, 500);
  }
});
