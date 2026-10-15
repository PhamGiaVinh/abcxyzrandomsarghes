import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  nextToAct,
  reconcileSidePots,
  reduceHand,
  isBettingRoundComplete,
  isRunout,
  validateAction,
  type ActionRow,
  type PlayerSeed,
  type ProposedAction,
  type Street,
} from "../_shared/trackerEngine/index.ts";
import {
  actionWorkflowForStreet,
  buildVoiceActionCanonicalRequest,
  buildVoiceBoardCanonicalRequest,
  buildVoiceFinishCanonicalRequest,
  buildVoiceHoleCardsCanonicalRequest,
  voiceCanonicalRequestsMatch,
} from "../../../src/lib/trackerVoice/canonicalRequest.ts";
import { routeTrackerVoiceIntent } from "../../../src/lib/trackerVoice/intentRouter.ts";
import { resolveNextVoiceHoleCardsSeatNumber } from "../../../src/lib/trackerVoice/holeCardsParser.ts";
import { computeVoiceFinishSettlement } from "../_shared/trackerSettlement/finishAssist.ts";
import { isManualFinishIntent, manualFinishReceiptMatches, manualFinishCancellationMatches } from "../../../src/lib/trackerManualFinish.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rollout safety: default to "warn" so merging this never blocks a live operator
// on a reconstruction edge case. Flip to "enforce" via env only after UAT.
//   TRACKER_VALIDATION_MODE = "warn" | "enforce" | "off"
const VALIDATION_MODE = (Deno.env.get("TRACKER_VALIDATION_MODE") || "warn").toLowerCase();
// Strict clockwise turn order is the most likely source of false rejections for
// live entry (heads-up, straddles, out-of-turn-but-allowed). Off by default even
// in enforce mode; opt in explicitly.
const ENFORCE_TURN_ORDER = (Deno.env.get("TRACKER_ENFORCE_TURN_ORDER") || "false") === "true";
const VOICE_AUTO_ENABLED = (Deno.env.get("TRACKER_VOICE_AUTO_ENABLED") || "false") === "true";
const VOICE_CAPABILITY_VERSION = Deno.env.get("TRACKER_VOICE_CAPABILITY_VERSION") || "tracker-voice-v0";

type VoiceSnapshot = {
  ok: boolean;
  error?: string;
  hand_id: string;
  button_seat: number;
  community_cards: string[];
  state_version: string;
  correction_pending: boolean;
  configured_mode: "shadow" | "assist" | "auto";
  provider_model: string;
  spoken_amount_unit: number;
  amount_unit_confirmed: boolean;
  players: Array<PlayerSeed & { entry_number: number }>;
  actions: ActionRow[];
};

type AuthoritativeVoiceFinish = {
  handNumber: number;
  handTime: string;
  settlement: Awaited<ReturnType<typeof computeVoiceFinishSettlement>>;
};

function streetForBoard(board: string[]): Street {
  if (board.length >= 5) return "river";
  if (board.length === 4) return "turn";
  if (board.length === 3) return "flop";
  return "preflop";
}

function workflowForVoiceSnapshot(snapshot: VoiceSnapshot):
  | "preflop_action" | "flop_action" | "turn_action" | "river_action"
  | "enter_flop" | "enter_turn" | "enter_river" | "runout_reveal" | "submit_ready" | null {
  const runtime = reduceHand(snapshot.players, snapshot.actions, snapshot.button_seat);
  const boardCount = snapshot.community_cards.length;
  const livePlayers = runtime.players.filter((player) => !player.is_folded);
  const bettingComplete = isBettingRoundComplete(runtime);
  if (
    boardCount < 5
    && livePlayers.length >= 2
    && isRunout(runtime)
    && bettingComplete
  ) return "runout_reveal";
  if (!bettingComplete) {
    const actionWorkflow = actionWorkflowForStreet(streetForBoard(snapshot.community_cards));
    return actionWorkflow === "preflop_action" || actionWorkflow === "flop_action"
      || actionWorkflow === "turn_action" || actionWorkflow === "river_action"
      ? actionWorkflow
      : null;
  }
  if (
    livePlayers.length === 1
    || (boardCount === 5 && livePlayers.length >= 2)
  ) return "submit_ready";
  if (boardCount === 0 && runtime.street === "preflop") return "enter_flop";
  if (boardCount === 3 && runtime.street === "flop") return "enter_turn";
  if (boardCount === 4 && runtime.street === "turn") return "enter_river";
  return null;
}

function clockwiseAfter<T extends { seat_number: number }>(players: T[], seat: number): T | null {
  const ordered = [...players].sort((a, b) => a.seat_number - b.seat_number);
  return ordered.find((player) => player.seat_number > seat) ?? ordered[0] ?? null;
}

function resolveVoiceActor(snapshot: VoiceSnapshot, street: Street): {
  playerId: string;
  entryNumber: number;
  seatNumber: number;
  currentBet: number;
  stack: number;
  highestBet: number;
  currentActorSeatNumber: number;
} | null {
  const runtime = reduceHand(snapshot.players, snapshot.actions, snapshot.button_seat);
  const hasStreetAction = snapshot.actions.some((action) => action.street === street);
  let currentPlayerId = nextToAct(snapshot.players, snapshot.actions, snapshot.button_seat);
  if (!currentPlayerId && !hasStreetAction && street !== runtime.street) {
    currentPlayerId = clockwiseAfter(
      runtime.players.filter((player) => !player.is_folded && !player.is_all_in),
      snapshot.button_seat,
    )?.player_id ?? null;
  }
  if (!currentPlayerId) return null;
  const currentSeed = snapshot.players.find((candidate) => candidate.player_id === currentPlayerId);
  if (!currentSeed) return null;
  const player = runtime.players.find((candidate) => candidate.player_id === currentSeed.player_id);
  if (!player || player.is_folded || player.is_all_in || player.stack <= 0) return null;
  const newStreet = street !== runtime.street;
  const currentBet = newStreet ? 0 : player.street_bet;
  const hasActionOpen = newStreet || !player.has_acted_this_street || currentBet < runtime.highestBet;
  if (!hasActionOpen) return null;
  return {
    playerId: currentSeed.player_id,
    entryNumber: currentSeed.entry_number || 1,
    seatNumber: currentSeed.seat_number,
    currentBet,
    stack: player.stack,
    highestBet: newStreet ? 0 : runtime.highestBet,
    currentActorSeatNumber: currentSeed.seat_number,
  };
}

function providerForVoiceRequest(providerName: unknown): "mock" | "openai_realtime" | "gemini_live" {
  return providerName === "mock" ? "mock" : providerName === "gemini_live" ? "gemini_live" : "openai_realtime";
}

async function loadAuthoritativeVoiceFinish(input: {
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  snapshot: VoiceSnapshot;
}): Promise<AuthoritativeVoiceFinish> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) throw new Error("tracker_voice_service_not_configured");
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: hand, error: handError }, { data: players, error: playersError }, { data: actions, error: actionsError }] = await Promise.all([
    service.from("tournament_hands").select("id, hand_number, created_at, button_seat, community_cards, status, is_voided")
      .eq("id", input.handId).eq("tournament_id", input.tournamentId).eq("table_id", input.tournamentTableId).maybeSingle(),
    service.from("hand_players").select("player_id, entry_number, seat_number, starting_stack, hole_cards, player_name")
      .eq("hand_id", input.handId).order("seat_number"),
    service.from("hand_actions").select("player_id, entry_number, street, action_type, action_amount, action_order")
      .eq("hand_id", input.handId).order("action_order"),
  ]);
  if (handError || playersError || actionsError || !hand || hand.status !== "in_progress" || hand.is_voided) {
    throw new Error("finish_snapshot_unavailable");
  }
  const runtime = reduceHand(input.snapshot.players, input.snapshot.actions, input.snapshot.button_seat);
  const settlement = await computeVoiceFinishSettlement({
    handId: input.handId,
    stateVersion: input.snapshot.state_version,
    buttonSeat: Number(hand.button_seat),
    communityCards: Array.isArray(hand.community_cards) ? hand.community_cards as string[] : [],
    players: (players ?? []).map((player: Record<string, unknown>) => ({
      player_id: String(player.player_id),
      entry_number: Number(player.entry_number),
      seat_number: Number(player.seat_number),
      starting_stack: Number(player.starting_stack),
      hole_cards: Array.isArray(player.hole_cards) ? player.hole_cards as string[] : [],
      player_name: typeof player.player_name === "string" ? player.player_name : null,
    })),
    actions: (actions ?? []).map((action: Record<string, unknown>) => ({
      player_id: String(action.player_id),
      entry_number: Number(action.entry_number),
      street: typeof action.street === "string" ? action.street : "preflop",
      action_type: String(action.action_type),
      action_amount: typeof action.action_amount === "number" ? action.action_amount : 0,
      action_order: Number(action.action_order),
    })),
    bettingComplete: isBettingRoundComplete(runtime),
  });
  return {
    handNumber: Number(hand.hand_number),
    handTime: typeof hand.created_at === "string" ? hand.created_at : (() => {
      throw new Error("finish_snapshot_unavailable");
    })(),
    settlement,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json();
  const { tournament_id, action } = body;

  if (!tournament_id || !action) return new Response(JSON.stringify({ error: "Missing tournament_id or action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Load the trusted seeds + prior action stream + button for a hand so the
  // validation engine can reconstruct state. Server-authoritative — never the
  // client's view of state.
  async function loadHandForValidation(handId: string): Promise<
    { seeds: PlayerSeed[]; priorActions: ActionRow[]; buttonSeat: number } | null
  > {
    const [{ data: hand }, { data: hp }, { data: ha }] = await Promise.all([
      supabase.from("tournament_hands").select("button_seat").eq("id", handId).maybeSingle(),
      supabase.from("hand_players").select("player_id, seat_number, starting_stack").eq("hand_id", handId),
      supabase.from("hand_actions").select("player_id, street, action_type, action_amount, action_order").eq("hand_id", handId).order("action_order"),
    ]);
    if (!hand || !hp) return null;
    return {
      seeds: (hp as any[]).map((r) => ({
        player_id: r.player_id,
        seat_number: r.seat_number,
        starting_stack: r.starting_stack ?? 0,
      })),
      priorActions: (ha as any[] | null ?? []).map((r) => ({
        player_id: r.player_id,
        street: r.street ?? "preflop",
        action_type: r.action_type,
        action_amount: r.action_amount ?? 0,
        action_order: r.action_order,
      })),
      buttonSeat: (hand as any).button_seat ?? 1,
    };
  }

  const validationError = (code: string, message: string) =>
    new Response(JSON.stringify({ error: message, code, validation: { valid: false, code } }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Structured telemetry for a rejected/flagged validation verdict. Emitted for
  // BOTH enforce (hard 422) and warn (recorded anyway) so rejects are visible in
  // the Supabase dashboard Edge logs (the CLI cannot read them, and enforce
  // rejects otherwise leave no trail). Logs only non-sensitive identifiers + the
  // verdict — never hole cards, amounts, full payload, secrets, or auth tokens.
  const logValidationReject = (
    fields: { validation_code: string; hand_id?: string; player_id?: string; action_type?: string; street?: string },
  ) =>
    console.warn(
      "[tracker-validation:reject]",
      JSON.stringify({
        validation_code: fields.validation_code,
        tournament_id,
        hand_id: fields.hand_id,
        player_id: fields.player_id,
        action_type: fields.action_type,
        street: fields.street,
        mode: VALIDATION_MODE,
        turn_order_enabled: ENFORCE_TURN_ORDER,
      }),
    );

  let result: any;
  let validationNote: any = undefined;

  try {
    if ((action === "show_manual_cards_v1" || action === "get_manual_card_receipt_v1")
      && body.expected_actor_id !== undefined && body.expected_actor_id !== user.id) {
      return validationError("ACTOR_MISMATCH", "Tài khoản đã đổi; không áp intent của tài khoản trước.");
    }
    switch (action) {
      case "record_manual_hand_v1":
      case "get_manual_finish_receipt_v1":
      case "cancel_manual_finish_v1": {
        const intent = body.finish_intent;
        if (!isManualFinishIntent(intent) || intent.actor_id !== user.id || intent.tournament_id !== tournament_id) {
          return validationError("MANUAL_FINISH_CONTEXT_REQUIRED", "Finish thiếu intent gốc hoặc tài khoản đã thay đổi.");
        }
        if (action === "record_manual_hand_v1") {
          // A receipt binds the frozen intent: never silently rewrite its pots.
          // Use the same server reconciliation as legacy Finish, without changing rounding.
          const recon = reconcileSidePots(intent.payload.actions as ActionRow[], intent.payload.side_pots);
          if (recon.tampered) return validationError("SIDE_POTS_TAMPERED", "side_pots không khớp chuỗi hành động trên server.");
        }
        result = await supabase.rpc(action === "record_manual_hand_v1"
          ? "record_tracker_manual_hand_v1" : action === "cancel_manual_finish_v1"
            ? "cancel_tracker_manual_finish_v1" : "get_tracker_manual_finish_receipt_v1", { p_intent: intent });
        break;
      }
      case "record_hand": {
        // A stale client must not infer today's hand/session from a reusable
        // table and hand number. Voice uses its own scoped service receipt.
        return validationError("MANUAL_FINISH_CONTEXT_REQUIRED", "Phiên bản Finish cũ đã ngừng ghi. Tải lại bàn để dùng intent có session/epoch và request ID.");
      }
      case "void_hand": {
        const { hand_id } = body;
        result = await supabase.rpc("void_last_hand", { p_hand_id: hand_id });
        break;
      }
      case "delete_last_action": {
        return new Response(JSON.stringify({ error: "Hoàn tác action đang tạm khóa; gọi Floor để xử lý.", code: "UNDO_CAPABILITY_DISABLED" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "undo_last_action_v1": {
        const {
          tournament_table_id, hand_id, expected_action_id,
          expected_source_revision, idempotency_key,
        } = body;
        if (typeof tournament_table_id !== "string" || typeof hand_id !== "string"
          || typeof expected_action_id !== "string" || typeof idempotency_key !== "string"
          || !Number.isSafeInteger(expected_source_revision) || expected_source_revision < 1) {
          return validationError("INVALID_UNDO_REQUEST", "Yêu cầu hoàn tác thiếu action hoặc phiên bản máy chủ.");
        }
        result = await supabase.rpc("undo_tracker_last_action_v1", {
          p_tournament_id: tournament_id,
          p_tournament_table_id: tournament_table_id,
          p_hand_id: hand_id,
          p_expected_action_id: expected_action_id,
          p_expected_source_revision: expected_source_revision,
          p_idempotency_key: idempotency_key,
        });
        break;
      }
      case "update_stack": {
        return validationError("LEGACY_STACK_WRITE_RETIRED",
          "Hãy sửa stack trong danh sách ghế Tracker để xác minh đúng phiên bàn và đồng bộ chip.");
      }
      case "bulk_update": {
        return validationError("LEGACY_STACK_WRITE_RETIRED",
          "Hãy sửa stack trong danh sách ghế Tracker để xác minh đúng phiên bàn và đồng bộ chip.");
      }
      case "re_enter": {
        return validationError(
          "LEGACY_REENTRY_RETIRED",
          "Re-entry phải thực hiện trong Cashier để tạo đúng entry và ghi nhận buy-in. Không thể cấp stack qua Tracker.",
        );
      }
      case "start_hand": {
        const { table_id, hand_number, hand_time, button_seat,
          table_session_id, tournament_table_id, control_epoch } = body;
        if ((table_session_id !== undefined || tournament_table_id !== undefined || control_epoch !== undefined)
          && (typeof table_session_id !== "string" || typeof tournament_table_id !== "string"
            || !Number.isInteger(control_epoch) || control_epoch < 1)) {
          return validationError("INVALID_TRACKER_CONTEXT", "Phiên bàn Tracker không hợp lệ. Hãy tải lại bàn.");
        }
        const normalizedButtonSeat =
          Number.isInteger(button_seat) && button_seat >= 1 && button_seat <= 10
            ? button_seat
            : 1;
        result = table_session_id
          ? await supabase.rpc("start_tracker_hand_v3", {
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_table_session_id: table_session_id,
            p_control_epoch: control_epoch,
            p_hand_number: hand_number,
            p_hand_time: hand_time || new Date().toISOString(),
            p_created_by: user.id,
            p_button_seat: normalizedButtonSeat,
          })
          : await supabase.rpc("start_hand", {
            p_tournament_id: tournament_id,
            p_table_id: table_id,
            p_hand_number: hand_number,
            p_hand_time: hand_time || new Date().toISOString(),
            p_created_by: user.id,
            p_button_seat: normalizedButtonSeat,
          });
        break;
      }
      case "update_community_cards": {
        const { hand_id, community_cards } = body;
        result = await supabase.rpc("update_community_cards", {
          p_hand_id: hand_id,
          p_community_cards: community_cards,
          p_user_id: user.id,
        });
        break;
      }
      case "record_action": {
        const {
          hand_id, player_id, entry_number, street, action_type, action_amount,
          action_order, idempotency_key, trace_id, source, tournament_table_id, voice_event_id,
          expected_state_version,
        } = body;

        if (source === "voice" && (
          typeof voice_event_id !== "string"
          || typeof tournament_table_id !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
          || typeof expected_state_version !== "string"
        )) {
          return validationError("VOICE_METADATA_REQUIRED", "Voice action thiếu proof bắt buộc.");
        }

        if (VALIDATION_MODE !== "off" || source === "voice") {
          let loaded: { seeds: PlayerSeed[]; priorActions: ActionRow[]; buttonSeat: number } | null;
          if (source === "voice") {
            const { data: rawVoiceSnapshot, error: voiceSnapshotError } = await supabase.rpc(
              "get_tracker_voice_validation_snapshot",
              {
                p_tournament_id: tournament_id,
                p_tournament_table_id: tournament_table_id,
                p_hand_id: hand_id,
              },
            );
            const voiceSnapshot = rawVoiceSnapshot as VoiceSnapshot | null;
            if (voiceSnapshotError || !voiceSnapshot?.ok) {
              return validationError(
                voiceSnapshot?.error ?? "VOICE_SNAPSHOT_UNAVAILABLE",
                "Không tải được trạng thái hand hoặc assignment để xác minh Voice.",
              );
            }
            if (voiceSnapshot.state_version !== expected_state_version) {
              return validationError("STALE_STATE_VERSION", "Trạng thái bàn đã thay đổi. Hãy nói lại action.");
            }
            loaded = {
              seeds: voiceSnapshot.players,
              priorActions: voiceSnapshot.actions,
              buttonSeat: voiceSnapshot.button_seat,
            };
          } else {
            loaded = await loadHandForValidation(hand_id);
          }
          if (loaded) {
            const proposed: ProposedAction = {
              player_id,
              street: street || "preflop",
              action_type,
              action_amount: action_amount || 0,
              action_order,
            };
            const verdict = validateAction(loaded.seeds, loaded.priorActions, loaded.buttonSeat, proposed, {
              enforceTurnOrder: ENFORCE_TURN_ORDER,
            });
            if (!verdict.valid) {
              // Telemetry first so the reject is observable in BOTH modes
              // (enforce returns 422 below; warn records anyway).
              logValidationReject({ validation_code: verdict.code, hand_id, player_id, action_type, street: street || "preflop" });
              if (VALIDATION_MODE === "enforce" || source === "voice") {
                return validationError(verdict.code, verdict.message);
              }
              // warn: record anyway, but surface the verdict for observability.
              validationNote = { code: verdict.code, message: verdict.message, normalizedAmount: verdict.normalizedAmount };
            }
          }
        }

        result = await supabase.rpc("record_action", {
          p_hand_id: hand_id,
          p_player_id: player_id,
          p_entry_number: entry_number || 1,
          p_street: street || "preflop",
          p_action_type: action_type,
          p_action_amount: action_amount || 0,
          p_action_order: action_order,
          // Lock-owner binding + idempotent retry + trace plumbing (Session A).
          // NOTE: this Edge MUST be deployed only AFTER the record_action migration
          // (20260928000000) is live — the old signature lacks these params.
          p_user_id: user.id,
          p_idempotency_key: idempotency_key ?? null,
          p_trace_id: trace_id ?? null,
        });
        if (source === "voice" && result.data && typeof result.data === "object") {
          const verdict = result.data as { error?: unknown; voice_event_id?: unknown };
          if (typeof verdict.error === "string") {
            return new Response(JSON.stringify({ error: verdict.error, code: verdict.error }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (verdict.voice_event_id !== voice_event_id) {
            return validationError("VOICE_RECEIPT_MISMATCH", "Canonical receipt không khớp Voice event.");
          }
        }
        break;
      }
      case "validate_voice_event": {
        const {
          tournament_table_id, hand_id, final_transcript, provider_name,
          provider_model, provider_event_id, provider_confidence,
          execution_mode, expected_state_version, idempotency_key, trace_id, voice_request,
        } = body;
        if (
          typeof tournament_table_id !== "string"
          || typeof hand_id !== "string"
          || typeof final_transcript !== "string"
          || final_transcript.length < 1
          || final_transcript.length > 500
          || typeof expected_state_version !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
        ) {
          return validationError("VOICE_REQUEST_INVALID", "Voice event thiếu dữ liệu bắt buộc.");
        }

        const { data: rawSnapshot, error: snapshotError } = await supabase.rpc(
          "get_tracker_voice_validation_snapshot",
          {
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_hand_id: hand_id,
          },
        );
        const snapshot = rawSnapshot as VoiceSnapshot | null;
        if (snapshotError || !snapshot?.ok) {
          const code = snapshot?.error ?? "VOICE_SNAPSHOT_UNAVAILABLE";
          return validationError(code, "Không thể xác minh assignment hoặc trạng thái bàn.");
        }
        if (snapshot.state_version !== expected_state_version) {
          return validationError("STALE_STATE_VERSION", "Trạng thái bàn đã thay đổi. Hãy nói lại action.");
        }
        if (snapshot.correction_pending) {
          return validationError("CORRECTION_PENDING", "Đang chờ Floor sửa action trước đó.");
        }

        const expectedWorkflowState = workflowForVoiceSnapshot(snapshot);
        if (!expectedWorkflowState) {
          return validationError("wrong_workflow", "Voice chưa có bước nhập Board hoặc Action hợp lệ.");
        }
        // The route evaluates every enabled grammar independently. It never
        // trusts the browser's intentDomain and never falls back after an
        // Action parse/validation failure.
        const route = routeTrackerVoiceIntent(final_transcript, expectedWorkflowState, {
          spokenAmountUnit: snapshot.spoken_amount_unit,
          amountUnitConfirmed: snapshot.amount_unit_confirmed,
        });
        if (!route.ok) {
          return validationError(route.code, route.code === "wrong_workflow"
            ? "Câu Voice không hợp lệ ở bước Tracker hiện tại."
            : "Không nhận ra một lệnh Voice duy nhất.");
        }
        // Hole-card speech is private until a Dealer explicitly confirms it.
        // It must never enter the generic final-transcript event path.
        if (route.intentDomain === "hole_cards") {
          return validationError(
            "VOICE_HOLE_CARDS_CONFIRM_ONLY",
            "Bài tẩy Voice chỉ gửi khi Dealer chạm xác nhận bài của ghế.",
          );
        }
        if (route.intentDomain === "finish_hand") {
          return validationError(
            "VOICE_FINISH_CONFIRM_ONLY",
            "Finish Voice chỉ gửi khi Dealer chạm xác nhận lưu hand.",
          );
        }
        const mode = execution_mode === "assist" ? "assist" : "shadow";
        if (route.intentDomain === "board") {
          if (execution_mode === "auto") {
            return validationError("AUTO_CAPABILITY_MISSING", "Voice Board không hỗ trợ Auto.");
          }
          const command = route.command;
          const expectedExistingBoardCount = snapshot.community_cards.length;
          if (
            (command.street === "flop" && expectedExistingBoardCount !== 0)
            || (command.street === "turn" && expectedExistingBoardCount !== 3)
            || (command.street === "river" && expectedExistingBoardCount !== 4)
          ) {
            return validationError("board_already_persisted", "Street này đã có Board trên server. Hãy dùng luồng sửa thủ công.");
          }
          const cumulativeCards = [...snapshot.community_cards, ...command.newCards];
          if (new Set(cumulativeCards).size !== cumulativeCards.length) {
            return validationError("duplicate_card", "Board có lá bài trùng với bài đã xác nhận.");
          }
          const canonicalRequest = await buildVoiceBoardCanonicalRequest({
            rawTranscript: final_transcript,
            expectedStateVersion: snapshot.state_version,
            expectedWorkflowState,
            expectedStreet: command.street,
            payload: {
              street: command.street,
              newCards: command.newCards,
              cumulativeCards,
              expectedExistingBoardCount: expectedExistingBoardCount as 0 | 3 | 4,
            },
          });
          if (!voiceCanonicalRequestsMatch(voice_request, canonicalRequest)) {
            return validationError("intent_mismatch", "Đề xuất Board không còn khớp trạng thái server.");
          }
          if (mode !== "shadow" && mode !== "assist") {
            return validationError("AUTO_CAPABILITY_MISSING", "Voice Board chỉ hỗ trợ Shadow hoặc Assist.");
          }
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          if (!serviceKey || !supabaseUrl) throw new Error("tracker_voice_service_not_configured");
          const service = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          result = await service.rpc("_tracker_voice_register_validated_board_event", {
            p_actor_user_id: user.id,
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_hand_id: hand_id,
            p_provider_name: provider_name === "gemini_live" ? "gemini_live" : "openai_realtime",
            p_provider_model: typeof provider_model === "string" ? provider_model : snapshot.provider_model,
            p_provider_event_id: typeof provider_event_id === "string" ? provider_event_id : null,
            p_final_transcript: final_transcript,
            p_normalized_command: {
              kind: "board",
              intent_domain: "board",
              normalized_transcript: command.normalizedTranscript,
              grammar_version: "dealer-board-v1",
              vocabulary_version: "poker-dealer-v2",
              requires_confirmation: true,
              canonical_request: canonicalRequest,
            },
            p_expected_state_version: snapshot.state_version,
            p_execution_mode: mode,
            p_idempotency_key: idempotency_key,
            p_trace_id: trace_id,
          });
          break;
        }

        if (route.intentDomain !== "action") {
          return validationError("intent_mismatch", "Voice intent không khớp writer hiện tại.");
        }
        const command = route.command;
        if (command.kind === "report_wrong_action") {
          return validationError("ERROR_REPORT_CAPABILITY_DISABLED", "Báo sai action đang tạm khóa. Dùng nút Gọi Floor để được hỗ trợ; hand chưa tự dừng.");
        }
        if (command.amount?.ambiguous) {
          return validationError("VOICE_AMOUNT_AMBIGUOUS", "Số chip chưa rõ đơn vị.");
        }
        const street = streetForBoard(snapshot.community_cards ?? []);
        const actionOrder = (snapshot.actions.at(-1)?.action_order ?? 0) + 1;
        let normalizedCommand: Record<string, unknown> = {
          kind: command.kind,
          normalized_transcript: command.normalizedTranscript,
          risk_tier: command.riskTier,
          repairs: command.repairs,
          hardener_version: "dealer-hardener-v1",
          grammar_version: "dealer-command-v2",
          vocabulary_version: "poker-dealer-v2",
          requires_confirmation: command.requiresConfirmation,
        };

        if (command.kind !== "call_floor") {
          if (command.spokenSeatNumber === null) {
            return validationError("VOICE_SEAT_REQUIRED", "Hãy đọc rõ Ghế đang tới lượt trước action.");
          }
          const actor = resolveVoiceActor(snapshot, street);
          if (!actor) {
            return validationError(
              "VOICE_ACTOR_UNAVAILABLE",
              "Không xác định được người đang tới lượt.",
            );
          }
          if (command.spokenSeatNumber !== actor.seatNumber) {
            return validationError(
              "OUT_OF_TURN",
              `Đang tới Ghế ${actor.seatNumber}. Hãy đọc lại action cho Ghế ${actor.seatNumber}.`,
            );
          }
          const canonicalAction = command.kind === "bet_to"
            ? "bet"
            : command.kind === "raise_to"
              ? "raise"
              : command.kind;
          let actionAmount = 0;
          if (canonicalAction === "call") {
            actionAmount = Math.min(actor.stack, Math.max(0, actor.highestBet - actor.currentBet));
            const callToTotal = actor.currentBet + actionAmount;
            if (command.amount && command.amount.value !== callToTotal) {
              return validationError(
                "VOICE_CALL_TOTAL_MISMATCH",
                `Tổng call phải là ${callToTotal.toLocaleString("vi-VN")}.`,
              );
            }
          } else if (canonicalAction === "all_in") {
            actionAmount = actor.stack;
          } else if (canonicalAction === "bet" || canonicalAction === "raise") {
            if (!command.amount || command.amount.value === null) {
              return validationError("VOICE_AMOUNT_REQUIRED", "Bet/raise cần số chip.");
            }
            actionAmount = command.amount.value - actor.currentBet;
          }

          const proposed: ProposedAction = {
            player_id: actor.playerId,
            street,
            action_type: canonicalAction,
            action_amount: actionAmount,
            action_order: actionOrder,
          };
          const verdict = validateAction(
            snapshot.players,
            snapshot.actions,
            snapshot.button_seat,
            proposed,
            { enforceTurnOrder: true },
          );
          if (!verdict.valid) {
            logValidationReject({
              validation_code: verdict.code,
              hand_id,
              player_id: actor.playerId,
              action_type: canonicalAction,
              street,
            });
            return validationError(verdict.code, verdict.message);
          }
          // The browser request is diagnostic input, never authority: recompute
          // every field from raw speech and the locked server snapshot first.
          const expectedActionWorkflowState = actionWorkflowForStreet(street);
          if (!expectedActionWorkflowState || expectedActionWorkflowState !== expectedWorkflowState) {
            return validationError("intent_mismatch", "Voice Action chỉ hợp lệ trong vòng cược.");
          }
          const canonicalRequest = await buildVoiceActionCanonicalRequest({
            rawTranscript: final_transcript,
            expectedStateVersion: snapshot.state_version,
            expectedWorkflowState: expectedActionWorkflowState,
            expectedStreet: street,
            payload: {
              canonicalAction,
              actorPlayerId: actor.playerId,
              entryNumber: actor.entryNumber,
              seatNumber: actor.seatNumber,
              street,
              actionAmount: verdict.normalizedAmount,
              actionOrder,
            },
          });
          if (!voiceCanonicalRequestsMatch(voice_request, canonicalRequest)) {
            return validationError("intent_mismatch", "Đề xuất Voice không còn khớp trạng thái bàn trên server.");
          }
          normalizedCommand = {
            ...normalizedCommand,
            intent_domain: canonicalRequest.intentDomain,
            canonical_request: canonicalRequest,
            canonical_action: canonicalAction,
            actor_player_id: actor.playerId,
            spoken_seat_number: command.spokenSeatNumber,
            current_actor_seat_number: actor.currentActorSeatNumber,
            turn_order_enforced: true,
            entry_number: actor.entryNumber,
            street,
            action_amount: verdict.normalizedAmount,
            action_order: actionOrder,
          };
        }

        const actionMode = execution_mode === "auto" ? "auto" : execution_mode === "assist" ? "assist" : "shadow";
        if (command.requiresConfirmation && actionMode !== "shadow") {
          return validationError("VOICE_REPAIR_SHADOW_ONLY", "Lệnh đã sửa nhận dạng chỉ được hiển thị Shadow để xác nhận lại.");
        }
        if (actionMode === "auto" && (
          !VOICE_AUTO_ENABLED
          || VALIDATION_MODE !== "enforce"
          || !ENFORCE_TURN_ORDER
          || provider_confidence === null
          || provider_confidence === undefined
        )) {
          return validationError("AUTO_CAPABILITY_MISSING", "Auto chưa đủ capability server.");
        }

        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        if (!serviceKey || !supabaseUrl) {
          throw new Error("tracker_voice_service_not_configured");
        }
        const service = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        result = await service.rpc("_tracker_voice_register_validated_event", {
          p_actor_user_id: user.id,
          p_tournament_id: tournament_id,
          p_tournament_table_id: tournament_table_id,
          p_hand_id: hand_id,
          p_provider_name: provider_name === "mock"
            ? "mock"
            : provider_name === "gemini_live"
              ? "gemini_live"
              : "openai_realtime",
          p_provider_model: typeof provider_model === "string" ? provider_model : snapshot.provider_model,
          p_provider_event_id: typeof provider_event_id === "string" ? provider_event_id : null,
          p_provider_confidence: typeof provider_confidence === "number" ? provider_confidence : null,
          p_final_transcript: final_transcript,
          p_normalized_command: normalizedCommand,
          p_expected_state_version: expected_state_version,
          p_execution_mode: actionMode,
          p_idempotency_key: idempotency_key,
          p_trace_id: trace_id,
          p_validation_mode: "enforce",
          p_turn_order_enforced: true,
          p_capability_version: VOICE_CAPABILITY_VERSION,
        });
        break;
      }
      case "commit_voice_hole_cards": {
        const {
          tournament_table_id, hand_id, final_transcript, provider_name,
          provider_model, provider_event_id, expected_state_version,
          idempotency_key, trace_id, voice_request,
        } = body;
        if (
          typeof tournament_table_id !== "string"
          || typeof hand_id !== "string"
          || typeof final_transcript !== "string"
          || final_transcript.length < 1
          || final_transcript.length > 500
          || typeof expected_state_version !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
        ) {
          return validationError("VOICE_HOLE_CARDS_REQUEST_INVALID", "Voice bài tẩy thiếu dữ liệu xác nhận.");
        }
        const { data: rawSnapshot, error: snapshotError } = await supabase.rpc(
          "get_tracker_voice_validation_snapshot",
          {
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_hand_id: hand_id,
          },
        );
        const snapshot = rawSnapshot as VoiceSnapshot | null;
        if (snapshotError || !snapshot?.ok) {
          return validationError("VOICE_SNAPSHOT_UNAVAILABLE", "Không thể xác minh hand trước khi lật bài.");
        }
        if (snapshot.state_version !== expected_state_version) {
          return validationError("STALE_STATE_VERSION", "Trạng thái bàn đã thay đổi. Hãy đọc lại bài.");
        }
        if (snapshot.correction_pending || snapshot.configured_mode === "shadow") {
          return validationError("ASSIST_NOT_ALLOWED", "Voice bài tẩy chưa được phép xác nhận ở bàn này.");
        }
        const expectedWorkflowState = workflowForVoiceSnapshot(snapshot);
        if (expectedWorkflowState !== "runout_reveal") {
          return validationError(
            "SHOWDOWN_HOLE_CARDS_DEFERRED_MUCK_AUTHORITY",
            "Voice bài tẩy chỉ mở khi server xác nhận all-in runout; Showdown vẫn nhập tay.",
          );
        }
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        if (!serviceKey || !supabaseUrl) throw new Error("tracker_voice_service_not_configured");
        const service = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: holeCardRows, error: holeCardError } = await service
          .from("hand_players")
          .select("player_id,hole_cards")
          .eq("hand_id", hand_id);
        if (holeCardError) {
          return validationError("VOICE_HOLE_CARDS_STATE_UNAVAILABLE", "Không thể xác minh thứ tự lật bài.");
        }
        const persistedCardsByPlayer = new Map(
          (holeCardRows ?? []).map((row) => [
            String(row.player_id),
            Array.isArray(row.hole_cards) && row.hole_cards.length === 2,
          ]),
        );
        const runtime = reduceHand(snapshot.players, snapshot.actions, snapshot.button_seat);
        const runtimeByPlayer = new Map(runtime.players.map((player) => [player.player_id, player]));
        const seatByPlayer = new Map(snapshot.players.map((player) => [player.player_id, player.seat_number]));
        const impliedHoleCardsSeatNumber = resolveNextVoiceHoleCardsSeatNumber({
          players: snapshot.players.map((player) => ({
            playerId: player.player_id,
            seatNumber: player.seat_number,
            isFolded: runtimeByPlayer.get(player.player_id)?.is_folded ?? true,
            hasCards: persistedCardsByPlayer.get(player.player_id) ?? false,
          })),
          actions: snapshot.actions.map((action) => ({
            street: action.street,
            actionType: action.action_type,
            actionOrder: action.action_order,
            seatNumber: seatByPlayer.get(action.player_id) ?? 0,
          })),
          buttonSeat: snapshot.button_seat,
        });
        const route = routeTrackerVoiceIntent(final_transcript, expectedWorkflowState, {
          spokenAmountUnit: snapshot.spoken_amount_unit,
          amountUnitConfirmed: snapshot.amount_unit_confirmed,
          impliedHoleCardsSeatNumber,
        });
        if (!route.ok || route.intentDomain !== "hole_cards") {
          return validationError("VOICE_HOLE_CARDS_GRAMMAR_INVALID", "Cần đọc đúng: Seat/Ghế N + đúng hai lá bài.");
        }
        const target = snapshot.players.find((player) => player.seat_number === route.command.seatNumber);
        const runtimePlayer = runtime.players.find((player) => player.seat_number === route.command.seatNumber);
        if (!target || !runtimePlayer) {
          return validationError("HOLE_CARDS_SEAT_NOT_FOUND", "Ghế được đọc không có người chơi trong hand.");
        }
        if (runtimePlayer.is_folded) {
          return validationError("PLAYER_FOLDED", "Người chơi đã fold, không được Voice lật bài.");
        }
        const canonicalRequest = await buildVoiceHoleCardsCanonicalRequest({
          rawTranscript: final_transcript,
          expectedStateVersion: snapshot.state_version,
          payload: {
            seatNumber: target.seat_number,
            expectedPlayerId: target.player_id,
            expectedEntryNumber: target.entry_number,
            cards: route.command.cards,
          },
        });
        if (!voiceCanonicalRequestsMatch(voice_request, canonicalRequest)) {
          return validationError("intent_mismatch", "Đề xuất bài tẩy không còn khớp trạng thái server.");
        }
        result = await service.rpc("commit_tracker_voice_hole_cards_v0", {
          p_actor_user_id: user.id,
          p_tournament_id: tournament_id,
          p_tournament_table_id: tournament_table_id,
          p_hand_id: hand_id,
          p_provider_name: provider_name === "gemini_live" ? "gemini_live" : "openai_realtime",
          p_provider_model: typeof provider_model === "string" ? provider_model : snapshot.provider_model,
          p_provider_event_id: typeof provider_event_id === "string" ? provider_event_id : null,
          p_expected_state_version: snapshot.state_version,
          p_idempotency_key: idempotency_key,
          p_trace_id: trace_id,
          p_seat_number: route.command.seatNumber,
          p_hole_cards: route.command.cards,
        });
        break;
      }
      case "prepare_voice_finish": {
        const {
          tournament_table_id, hand_id, final_transcript, expected_state_version,
        } = body;
        if (
          typeof tournament_table_id !== "string"
          || typeof hand_id !== "string"
          || typeof final_transcript !== "string"
          || final_transcript.length < 1
          || final_transcript.length > 500
          || typeof expected_state_version !== "string"
        ) {
          return validationError("VOICE_FINISH_REQUEST_INVALID", "Voice Finish thiếu dữ liệu xác nhận.");
        }
        const { data: rawSnapshot, error: snapshotError } = await supabase.rpc(
          "get_tracker_voice_validation_snapshot",
          {
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_hand_id: hand_id,
          },
        );
        const snapshot = rawSnapshot as VoiceSnapshot | null;
        if (snapshotError || !snapshot?.ok) {
          return validationError(snapshot?.error ?? "VOICE_SNAPSHOT_UNAVAILABLE", "Không thể xác minh hand trước khi kết thúc.");
        }
        if (snapshot.state_version !== expected_state_version) {
          return validationError("STALE_STATE_VERSION", "Trạng thái bàn đã thay đổi. Hãy nói lại kết thúc hand.");
        }
        if (snapshot.correction_pending) {
          return validationError("CORRECTION_PENDING", "Đang chờ Floor sửa action trước đó.");
        }
        const expectedWorkflowState = workflowForVoiceSnapshot(snapshot);
        if (expectedWorkflowState !== "submit_ready") {
          return validationError("wrong_workflow", "Hand chưa đủ điều kiện engine để kết thúc.");
        }
        // Every grammar runs even here; only one exact Finish phrase is accepted.
        const route = routeTrackerVoiceIntent(final_transcript, expectedWorkflowState, {
          spokenAmountUnit: snapshot.spoken_amount_unit,
          amountUnitConfirmed: snapshot.amount_unit_confirmed,
        });
        if (!route.ok || route.intentDomain !== "finish_hand") {
          return validationError(route.ok ? "intent_mismatch" : route.code, "Cần đọc đúng duy nhất: kết thúc hand.");
        }
        let finish: AuthoritativeVoiceFinish;
        try {
          finish = await loadAuthoritativeVoiceFinish({
            tournamentId: tournament_id,
            tournamentTableId: tournament_table_id,
            handId: hand_id,
            snapshot,
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : "finish_requires_manual_showdown";
          return validationError(
            code === "finish_requires_manual_showdown" ? code : "finish_requires_manual_showdown",
            "Server chưa đủ bằng chứng showdown/fold-win để lưu hand. Hãy dùng luồng sửa thủ công.",
          );
        }
        result = {
          data: {
            ok: true,
            settlement_origin: finish.settlement.settlementOrigin,
            settlement_digest: finish.settlement.settlementDigest,
            state_version: snapshot.state_version,
            summary: finish.settlement.summary,
          },
          error: null,
        };
        break;
      }
      case "commit_voice_finish": {
        const {
          tournament_table_id, hand_id, final_transcript, provider_name,
          provider_model, provider_event_id, expected_state_version,
          idempotency_key, trace_id, voice_request,
        } = body;
        if (
          typeof tournament_table_id !== "string"
          || typeof hand_id !== "string"
          || typeof final_transcript !== "string"
          || final_transcript.length < 1
          || final_transcript.length > 500
          || typeof expected_state_version !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
        ) {
          return validationError("VOICE_FINISH_REQUEST_INVALID", "Voice Finish thiếu dữ liệu chạm xác nhận.");
        }
        const { data: rawSnapshot, error: snapshotError } = await supabase.rpc(
          "get_tracker_voice_validation_snapshot",
          {
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_hand_id: hand_id,
          },
        );
        const snapshot = rawSnapshot as VoiceSnapshot | null;
        if (snapshotError || !snapshot?.ok) {
          return validationError(snapshot?.error ?? "VOICE_SNAPSHOT_UNAVAILABLE", "Không thể xác minh hand trước khi lưu.");
        }
        if (snapshot.state_version !== expected_state_version) {
          return validationError("finish_proposal_stale", "Kết quả đã thay đổi. Hãy tạo lại đề xuất Finish.");
        }
        if (snapshot.correction_pending || snapshot.configured_mode === "shadow") {
          return validationError("ASSIST_NOT_ALLOWED", "Voice Finish chỉ xác nhận khi bàn đang ở Assist và không có correction.");
        }
        const expectedWorkflowState = workflowForVoiceSnapshot(snapshot);
        if (expectedWorkflowState !== "submit_ready") {
          return validationError("wrong_workflow", "Hand chưa đủ điều kiện engine để kết thúc.");
        }
        const route = routeTrackerVoiceIntent(final_transcript, expectedWorkflowState, {
          spokenAmountUnit: snapshot.spoken_amount_unit,
          amountUnitConfirmed: snapshot.amount_unit_confirmed,
        });
        if (!route.ok || route.intentDomain !== "finish_hand") {
          return validationError(route.ok ? "intent_mismatch" : route.code, "Cần đọc đúng duy nhất: kết thúc hand.");
        }
        let finish: AuthoritativeVoiceFinish;
        try {
          finish = await loadAuthoritativeVoiceFinish({
            tournamentId: tournament_id,
            tournamentTableId: tournament_table_id,
            handId: hand_id,
            snapshot,
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : "finish_requires_manual_showdown";
          return validationError(
            code === "finish_requires_manual_showdown" ? code : "finish_requires_manual_showdown",
            "Server chưa đủ bằng chứng showdown/fold-win để lưu hand. Hãy dùng luồng sửa thủ công.",
          );
        }
        const canonicalRequest = await buildVoiceFinishCanonicalRequest({
          rawTranscript: final_transcript,
          expectedStateVersion: snapshot.state_version,
          payload: {
            settlementOrigin: finish.settlement.settlementOrigin,
            settlementDigest: finish.settlement.settlementDigest,
          },
        });
        if (!voiceCanonicalRequestsMatch(voice_request, canonicalRequest)) {
          return validationError("finish_proposal_stale", "Đề xuất Finish không còn khớp settlement server.");
        }
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        if (!serviceKey || !supabaseUrl) throw new Error("tracker_voice_service_not_configured");
        const service = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        result = await service.rpc("commit_tracker_voice_finish_v0", {
          p_actor_user_id: user.id,
          p_tournament_id: tournament_id,
          p_tournament_table_id: tournament_table_id,
          p_hand_id: hand_id,
          p_provider_name: providerForVoiceRequest(provider_name),
          p_provider_model: typeof provider_model === "string" ? provider_model : snapshot.provider_model,
          p_provider_event_id: typeof provider_event_id === "string" ? provider_event_id : null,
          p_final_transcript: final_transcript,
          p_expected_state_version: snapshot.state_version,
          p_idempotency_key: idempotency_key,
          p_trace_id: trace_id,
          p_settlement_origin: finish.settlement.settlementOrigin,
          p_settlement_digest: finish.settlement.settlementDigest,
          p_record_payload: {
            hand_number: finish.handNumber,
            hand_time: finish.handTime,
            players: finish.settlement.recordPlayers,
            actions: finish.settlement.recordActions,
            side_pots: finish.settlement.sidePots,
            community_cards: snapshot.community_cards,
            pot_size: finish.settlement.potSize,
          },
        });
        break;
      }
      case "show_hole_cards": {
        const { hand_id, player_hole_cards } = body;
        result = await supabase.rpc("show_hole_cards", {
          p_hand_id: hand_id,
          p_player_hole_cards: player_hole_cards,
          p_user_id: user.id,
        });
        break;
      }
      case "show_manual_cards_v1": {
        const { hand_id, player_hole_cards, table_session_id, control_epoch, expected_source_revision, request_id } = body;
        if (typeof hand_id !== "string" || typeof table_session_id !== "string"
          || !Number.isSafeInteger(control_epoch) || control_epoch < 1
          || !Number.isSafeInteger(expected_source_revision) || expected_source_revision < 0
          || typeof request_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$/.test(request_id)
          || !Array.isArray(player_hole_cards) || player_hole_cards.length === 0) {
          return validationError("MANUAL_CARD_CONTEXT_REQUIRED", "Lật bài thiếu session, epoch, revision hoặc request ID hợp lệ.");
        }
        // Same authenticated JWT client, never service-role delegation or actor
        // from the body. The RPC owns authority, CAS, deck, mutation and receipt.
        result = await supabase.rpc("show_tracker_manual_cards_v1", {
          p_hand_id: hand_id, p_session_id: table_session_id, p_epoch: control_epoch,
          p_revision: expected_source_revision, p_request_key: request_id, p_cards: player_hole_cards,
        });
        break;
      }
      case "get_manual_card_receipt_v1": {
        const { request_id, hand_id, table_session_id, control_epoch, expected_source_revision, player_hole_cards } = body;
        if (typeof request_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$/.test(request_id)
          || typeof hand_id !== "string" || typeof table_session_id !== "string"
          || !Number.isSafeInteger(control_epoch) || control_epoch < 1
          || !Number.isSafeInteger(expected_source_revision) || expected_source_revision < 0
          || !Array.isArray(player_hole_cards) || player_hole_cards.length === 0) {
          return validationError("MANUAL_CARD_CONTEXT_REQUIRED", "Tra receipt thiếu intent gốc hợp lệ.");
        }
        // Read-only actor-bound proof; it does not restore current write authority.
        result = await supabase.rpc("get_tracker_manual_card_receipt_v1", {
          p_request_key: request_id,
          p_expected_payload: { hand_id, table_session_id, control_epoch, expected_source_revision, player_hole_cards },
        });
        break;
      }
      case "commit_voice_board": {
        const { hand_id, voice_event_id, idempotency_key, trace_id } = body;
        if (
          typeof hand_id !== "string"
          || typeof voice_event_id !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
        ) {
          return validationError("VOICE_BOARD_METADATA_REQUIRED", "Voice Board thiếu receipt hoặc idempotency proof.");
        }
        // The authenticated RPC owns the complete transaction. This Edge path
        // deliberately performs no Board DML and makes no second RPC call.
        result = await supabase.rpc("commit_tracker_voice_board_v0", {
          p_voice_event_id: voice_event_id,
          p_idempotency_key: idempotency_key,
          p_trace_id: trace_id,
        });
        break;
      }
      case "heartbeat_lock": {
        const { hand_id } = body;
        result = await supabase.rpc("heartbeat_lock", {
          p_hand_id: hand_id,
          p_user_id: user.id,
        });
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "record_manual_hand_v1" && result.error?.code === "P0001"
      && result.error.message === "tracker_correction_pending") {
      // This explicit PostgreSQL exception rolls the entire RPC statement back.
      // Other database/transport errors still have unknown outcomes.
      return new Response(JSON.stringify({ error: "Bàn đang chờ Floor xử lý báo sai hand; chưa thể Finish.",
        code: "tracker_correction_pending" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (result.error) throw result.error;
    if (action === "record_manual_hand_v1" || action === "get_manual_finish_receipt_v1" || action === "cancel_manual_finish_v1") {
      const proof = result.data;
      if (proof && typeof proof.error === "string") {
        return new Response(JSON.stringify({ error: proof.error, code: proof.error }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!manualFinishReceiptMatches(proof, body.finish_intent) && !manualFinishCancellationMatches(proof, body.finish_intent)) {
        return new Response(JSON.stringify({ error: "manual_finish_receipt_unconfirmed", code: "manual_finish_receipt_unconfirmed" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // `start_hand` returns a JSONB policy denial for an unclassified Manual
    // table. Do not wrap that as a successful Edge response: older callers
    // otherwise set local `handStarted=true` even though no hand was inserted.
    if (action === "start_hand" && result.data && typeof result.data === "object") {
      const verdict = result.data as { error?: unknown; error_code?: unknown };
      if (typeof verdict.error === "string") {
        const code = typeof verdict.error_code === "string" ? verdict.error_code : undefined;
        const message = code === "tracker_table_required"
          ? "Bàn này đang ở chế độ Manual Floor. Hãy chọn Live Tracker trước khi bắt đầu hand."
          : verdict.error;
        return new Response(JSON.stringify({ error: message, ...(code ? { code } : {}) }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // A JSONB denial from the canonical action RPC is an authoritative failure,
    // not a successful Edge envelope. This keeps non-Voice callers fail-closed too.
    if ((action === "record_action" || action === "show_hole_cards" || action === "show_manual_cards_v1" || action === "get_manual_card_receipt_v1" || action === "commit_voice_board" || action === "commit_voice_hole_cards" || action === "commit_voice_finish") && result.data && typeof result.data === "object") {
      const verdict = result.data as { error?: unknown };
      if (typeof verdict.error === "string") {
        return new Response(JSON.stringify({ error: verdict.error, code: verdict.error }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (action === "show_manual_cards_v1") {
      const proof = result.data;
      if (!proof || proof.status !== "success" || proof.hand_id !== body.hand_id
        || proof.table_session_id !== body.table_session_id || proof.control_epoch !== body.control_epoch
        || proof.request_key !== body.request_id || proof.expected_source_revision !== body.expected_source_revision
        || !Number.isSafeInteger(proof.committed_source_revision)
        || proof.committed_source_revision <= body.expected_source_revision
        || !Number.isInteger(proof.entry_count) || proof.entry_count !== body.player_hole_cards.length) {
        return new Response(JSON.stringify({ error: "manual_card_receipt_unconfirmed", code: "manual_card_receipt_unconfirmed" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (action === "get_manual_card_receipt_v1") {
      const proof = result.data;
      const committed = proof?.status === "committed" && proof.request_key === body.request_id
        && typeof proof.hand_id === "string" && typeof proof.table_session_id === "string"
        && Number.isSafeInteger(proof.control_epoch) && proof.control_epoch > 0
        && Number.isSafeInteger(proof.expected_source_revision) && proof.expected_source_revision >= 0
        && Number.isSafeInteger(proof.committed_source_revision)
        && proof.committed_source_revision > proof.expected_source_revision
        && Number.isInteger(proof.entry_count) && proof.entry_count > 0
        && typeof proof.request_hash === "string" && /^[a-f0-9]{64}$/.test(proof.request_hash);
      if (proof?.status !== "not_found" && !committed) {
        return new Response(JSON.stringify({ error: "manual_card_receipt_unconfirmed", code: "manual_card_receipt_unconfirmed" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Echo the caller's trace_id (when present) for end-to-end correlation. The RPC
    // JSONB (in `data`) carries the authoritative verdict incl. duplicate/conflict/lock.
    return new Response(JSON.stringify({ status: "success", data: result.data, ...(body.trace_id ? { trace_id: body.trace_id } : {}), ...(validationNote ? { validation: validationNote } : {}) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
