// Centralized builders for the 7 `tournament-live-update` Edge payloads.
//
// Historical payload shapes extracted from the former HandInputPanel. Embedded
// and full-screen consoles now share useStandaloneHandInput. The record_hand
// builder supplies the draft schema inside the new exact Finish intent; it is
// NOT permission to call the retired bare Edge action. standaloneEdge.parity
// tests pin builder outputs, not the availability of obsolete write endpoints.
//
// These are PURE functions: no Supabase, no Date, no React. `hand_time` is passed
// in by the caller (the panel uses `new Date().toISOString()` at call time) so the
// builders stay deterministic and testable.
//
// Action values (unchanged contract): start_hand · record_action ·
// update_community_cards · show_hole_cards · record_hand · void_hand ·
// delete_last_action. `action_amount` is always chips ADDED (never "bet to").

import type { PotLayer } from "@/lib/tracker-poker/potEngine";
import type { VoiceActionMetadata } from "@/lib/trackerVoice";

/** Local player shape (subset of HandInputPanel's PlayerState the payloads read). */
export interface EdgePlayer {
  player_id: string;
  entry_number: number;
  seat_number: number;
  starting_stack: number;
  current_stack: number;
}

/** Local action-log row (subset of HandInputPanel's ActionRecord). */
export interface EdgeAction {
  player_id: string;
  action_type: string;
  /** Chips ADDED this action (HandInputPanel `ActionRecord.amount`). */
  amount: number;
  action_order: number;
  street: string;
}

/** One revealed hand for show_hole_cards. */
export interface HoleCardEntry {
  player_id: string;
  entry_number: number;
  hole_cards: string[];
}

// --- start_hand (HandInputPanel.tsx:621-630) -------------------------------
export function buildStartHandBody(p: {
  tournamentId: string;
  tableId: string;
  handNumber: number | string;
  handTime: string;
  buttonSeat: number;
  tableSessionId?: string | null;
  tournamentTableId?: string | null;
  controlEpoch?: number | null;
}) {
  return {
    tournament_id: p.tournamentId,
    action: "start_hand",
    table_id: p.tableId,
    hand_number: Number(p.handNumber),
    hand_time: p.handTime,
    button_seat: p.buttonSeat,
    ...(p.tableSessionId ? {
      table_session_id: p.tableSessionId,
      tournament_table_id: p.tournamentTableId,
      control_epoch: p.controlEpoch,
    } : {}),
  };
}

// --- record_action (HandInputPanel.tsx:843-849) ----------------------------
export function buildRecordActionBody(p: {
  tournamentId: string;
  handId: string;
  playerId: string;
  entryNumber: number;
  street: string;
  actionType: string;
  /** Chips ADDED (NOT "bet to" total) — converted via betToAdded before this call. */
  actionAmount: number;
  actionOrder: number;
  metadata?: VoiceActionMetadata;
}) {
  return {
    tournament_id: p.tournamentId,
    action: "record_action",
    hand_id: p.handId,
    player_id: p.playerId,
    entry_number: p.entryNumber,
    street: p.street,
    action_type: p.actionType,
    action_amount: p.actionAmount,
    action_order: p.actionOrder,
    ...(p.metadata
      ? {
          source: p.metadata.source,
          tournament_table_id: p.metadata.tournamentTableId,
          voice_event_id: p.metadata.voiceEventId,
          idempotency_key: p.metadata.idempotencyKey,
          trace_id: p.metadata.traceId,
          expected_state_version: p.metadata.expectedStateVersion,
        }
      : {}),
  };
}

// --- update_community_cards (HandInputPanel.tsx:992-994) --------------------
export function buildUpdateCommunityCardsBody(p: {
  tournamentId: string;
  handId: string;
  /** Already filtered to non-null cards by the caller. */
  communityCards: string[];
}) {
  return {
    tournament_id: p.tournamentId,
    action: "update_community_cards",
    hand_id: p.handId,
    community_cards: p.communityCards,
  };
}

// --- show_hole_cards (HandInputPanel.tsx:1023-1025) ------------------------
export function buildShowHoleCardsBody(p: {
  tournamentId: string;
  handId: string;
  playerHoleCards: HoleCardEntry[];
  manualContext?: { tableSessionId: string; controlEpoch: number; sourceRevision: number; requestId: string; actorId?: string };
}) {
  if (p.manualContext) return {
    tournament_id: p.tournamentId, action: "show_manual_cards_v1", hand_id: p.handId,
    player_hole_cards: p.playerHoleCards, table_session_id: p.manualContext.tableSessionId,
    control_epoch: p.manualContext.controlEpoch, expected_source_revision: p.manualContext.sourceRevision,
    request_id: p.manualContext.requestId,
    ...(p.manualContext.actorId !== undefined ? { expected_actor_id: p.manualContext.actorId } : {}),
  };
  return {
    tournament_id: p.tournamentId,
    action: "show_hole_cards",
    hand_id: p.handId,
    player_hole_cards: p.playerHoleCards,
  };
}

// --- record_hand (HandInputPanel.tsx:1097-1109) ----------------------------
// finalPlayers (1091-1096) + the actions map (1104-1106, entry_number looked up
// from `players`, NOT from the action row) reproduced exactly.
export function buildRecordHandBody(p: {
  tournamentId: string;
  tableId: string;
  handNumber: number | string;
  handTime: string;
  /** Already filtered to non-null. */
  communityCards: string[];
  potSize: number;
  players: EdgePlayer[];
  endingStacks: Record<string, number>;
  playerHoleCards: Record<string, (string | null)[]>;
  /** Result of toSidePotsJson(potBreakdown). */
  sidePots: PotLayer[];
  actions: EdgeAction[];
}) {
  const finalPlayers = p.players.map((pl) => ({
    player_id: pl.player_id,
    entry_number: pl.entry_number,
    seat_number: pl.seat_number,
    starting_stack: pl.starting_stack,
    ending_stack: p.endingStacks[pl.player_id] ?? pl.current_stack,
    is_eliminated: (p.endingStacks[pl.player_id] ?? pl.current_stack) === 0,
    hole_cards: p.playerHoleCards[pl.player_id]
      ? p.playerHoleCards[pl.player_id].filter((c): c is string => c !== null)
      : [],
  }));
  return {
    tournament_id: p.tournamentId,
    action: "record_hand",
    table_id: p.tableId,
    hand_number: Number(p.handNumber),
    hand_time: p.handTime,
    community_cards: p.communityCards,
    pot_size: p.potSize,
    players: finalPlayers,
    side_pots: p.sidePots,
    actions: p.actions.map((a) => ({
      player_id: a.player_id,
      entry_number: p.players.find((pl) => pl.player_id === a.player_id)?.entry_number || 1,
      action_type: a.action_type,
      action_amount: a.amount,
      action_order: a.action_order,
      street: a.street,
    })),
  };
}

// --- void_hand (HandInputPanel.tsx:724-726 / 1142-1144) --------------------
export function buildVoidHandBody(p: { tournamentId: string; handId: string }) {
  return {
    tournament_id: p.tournamentId,
    action: "void_hand",
    hand_id: p.handId,
  };
}

// --- delete_last_action (HandInputPanel.tsx:961-963) -----------------------
export function buildDeleteLastActionBody(p: {
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  expectedActionId: string;
  expectedSourceRevision: number;
  idempotencyKey: string;
}) {
  return {
    tournament_id: p.tournamentId,
    tournament_table_id: p.tournamentTableId,
    action: "undo_last_action_v1",
    hand_id: p.handId,
    expected_action_id: p.expectedActionId,
    expected_source_revision: p.expectedSourceRevision,
    idempotency_key: p.idempotencyKey,
  };
}

/**
 * Extract the REAL error message from a `supabase.functions.invoke` result. On a
 * non-2xx, supabase-js sets `error` to a FunctionsHttpError (whose `.message` is only
 * the generic "Edge Function returned a non-2xx status code") and `data` to null, with
 * the failed Response on `error.context`. This reads that response body's `{ error }`
 * so the operator sees the actual RPC/Postgres message (e.g. the real cause of a failed
 * void/record), not the opaque "non-2xx".
 */
export async function readEdgeError(error: any, data: any): Promise<string> {
  if (data?.error) return String(data.error);
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.json === "function") {
      const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
      const body = await res.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } else if (ctx && typeof ctx.text === "function") {
      const txt = await ctx.text();
      if (txt) return txt;
    }
  } catch {
    /* body already consumed or not JSON — fall through to the generic message */
  }
  return error?.message || "Lỗi không xác định";
}
