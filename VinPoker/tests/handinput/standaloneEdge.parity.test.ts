// Write-path parity pins for the standalone operator console.
//
// The console (/tracker/hand-input) MUST send the exact same 7 `tournament-live-update`
// Edge payloads as the embedded HandInputPanel. These tests freeze every builder's
// output shape — `action_amount` stays "chips added", entry_number for record_hand
// is looked up from `players` (never the action row), and no key is added/dropped.
// Any future drift in handInputEdge.ts fails here before it can reach the Edge fn.

import { describe, it, expect } from "vitest";
import {
  buildStartHandBody,
  buildRecordActionBody,
  buildUpdateCommunityCardsBody,
  buildShowHoleCardsBody,
  buildRecordHandBody,
  buildVoidHandBody,
  buildDeleteLastActionBody,
  type EdgePlayer,
  type EdgeAction,
} from "@/components/cashier/tournament-live/handinput/handInputEdge";

describe("handInputEdge — write-path parity", () => {
  it("start_hand body is exact", () => {
    expect(
      buildStartHandBody({
        tournamentId: "T1",
        tableId: "TB8",
        handNumber: 128,
        handTime: "2026-06-18T00:00:00.000Z",
        buttonSeat: 3,
      })
    ).toEqual({
      tournament_id: "T1",
      action: "start_hand",
      table_id: "TB8",
      hand_number: 128,
      hand_time: "2026-06-18T00:00:00.000Z",
      button_seat: 3,
    });
  });

  it("start_hand coerces a string hand number with Number()", () => {
    expect(buildStartHandBody({
      tournamentId: "T1", tableId: "TB8", handNumber: "12", handTime: "x", buttonSeat: 1,
    }).hand_number).toBe(12);
  });

  it("start_hand carries the V3 lease and fencing epoch only for a V3 table", () => {
    expect(buildStartHandBody({
      tournamentId: "T1", tableId: "GT5", handNumber: 2, handTime: "x", buttonSeat: 3,
      tournamentTableId: "TT5", tableSessionId: "S5", controlEpoch: 4,
    })).toEqual({
      tournament_id: "T1", action: "start_hand", table_id: "GT5",
      hand_number: 2, hand_time: "x", button_seat: 3,
      tournament_table_id: "TT5", table_session_id: "S5", control_epoch: 4,
    });
  });

  it("record_action carries action_amount as chips ADDED (not bet-to)", () => {
    expect(
      buildRecordActionBody({
        tournamentId: "T1",
        handId: "H9",
        playerId: "p2",
        entryNumber: 1,
        street: "flop",
        actionType: "raise",
        actionAmount: 2400, // already converted via betToAdded() by the caller
        actionOrder: 5,
      })
    ).toEqual({
      tournament_id: "T1",
      action: "record_action",
      hand_id: "H9",
      player_id: "p2",
      entry_number: 1,
      street: "flop",
      action_type: "raise",
      action_amount: 2400,
      action_order: 5,
    });
  });

  it("update_community_cards body is exact", () => {
    expect(
      buildUpdateCommunityCardsBody({
        tournamentId: "T1",
        handId: "H9",
        communityCards: ["Ah", "Kd", "Qc"],
      })
    ).toEqual({
      tournament_id: "T1",
      action: "update_community_cards",
      hand_id: "H9",
      community_cards: ["Ah", "Kd", "Qc"],
    });
  });

  it("show_hole_cards body is exact", () => {
    expect(
      buildShowHoleCardsBody({
        tournamentId: "T1",
        handId: "H9",
        playerHoleCards: [{ player_id: "p1", entry_number: 1, hole_cards: ["Ah", "Ad"] }],
      })
    ).toEqual({
      tournament_id: "T1",
      action: "show_hole_cards",
      hand_id: "H9",
      player_hole_cards: [{ player_id: "p1", entry_number: 1, hole_cards: ["Ah", "Ad"] }],
    });
  });
  it("manual cards carry exact session epoch revision and durable request identity", () => {
    const intent = {
      tournamentId: "T1", handId: "H9",
      playerHoleCards: [{ player_id: "p1", entry_number: 1, hole_cards: ["Ah", "Ad"] }],
      manualContext: { tableSessionId: "S9", controlEpoch: 4, sourceRevision: 12,
        requestId: "manual-card-request-0001" },
    };
    expect(buildShowHoleCardsBody(intent)).toEqual({
      tournament_id: "T1", action: "show_manual_cards_v1", hand_id: "H9",
      player_hole_cards: intent.playerHoleCards, table_session_id: "S9",
      control_epoch: 4, expected_source_revision: 12, request_id: "manual-card-request-0001",
    });
  });

  it("void_hand and durable undo bodies are exact", () => {
    expect(buildVoidHandBody({ tournamentId: "T1", handId: "H9" })).toEqual({
      tournament_id: "T1",
      action: "void_hand",
      hand_id: "H9",
    });
    expect(buildDeleteLastActionBody({
      tournamentId: "T1", tournamentTableId: "TT1", handId: "H9",
      expectedActionId: "A9", expectedSourceRevision: 7, idempotencyKey: "K9",
    })).toEqual({
      tournament_id: "T1",
      tournament_table_id: "TT1",
      action: "undo_last_action_v1",
      hand_id: "H9",
      expected_action_id: "A9",
      expected_source_revision: 7,
      idempotency_key: "K9",
    });
  });

  it("record_hand: entry_number per action is looked up from players, not the action row", () => {
    const players: EdgePlayer[] = [
      { player_id: "p1", entry_number: 7, seat_number: 1, starting_stack: 10000, current_stack: 12000 },
      { player_id: "p2", entry_number: 9, seat_number: 2, starting_stack: 10000, current_stack: 0 },
    ];
    const actions: EdgeAction[] = [
      { player_id: "p1", action_type: "bet", amount: 500, action_order: 1, street: "flop" },
      { player_id: "p2", action_type: "call", amount: 500, action_order: 2, street: "flop" },
      { player_id: "pX", action_type: "fold", amount: 0, action_order: 3, street: "flop" }, // unknown → fallback 1
    ];
    const body = buildRecordHandBody({
      tournamentId: "T1",
      tableId: "TB8",
      handNumber: 128,
      handTime: "ts",
      communityCards: ["Ah", "Kd", "Qc"],
      potSize: 1000,
      players,
      endingStacks: { p1: 12000 }, // p2 omitted → falls back to current_stack (0)
      playerHoleCards: { p1: ["Ah", "Ad"], p2: ["Kc", null] }, // null filtered out
      sidePots: [],
      actions,
    });

    expect(body.action).toBe("record_hand");
    expect(body.hand_number).toBe(128);
    // entry_number resolved from players map
    expect(body.actions.map((a) => a.entry_number)).toEqual([7, 9, 1]);
    // action_amount mirrors the local `amount` (chips added)
    expect(body.actions.map((a) => a.action_amount)).toEqual([500, 500, 0]);

    // finalPlayers: ending stack / elimination / hole-card filtering
    const fp1 = body.players.find((p) => p.player_id === "p1")!;
    const fp2 = body.players.find((p) => p.player_id === "p2")!;
    expect(fp1.ending_stack).toBe(12000);
    expect(fp1.is_eliminated).toBe(false);
    expect(fp1.hole_cards).toEqual(["Ah", "Ad"]);
    expect(fp2.ending_stack).toBe(0); // omitted from endingStacks → current_stack
    expect(fp2.is_eliminated).toBe(true);
    expect(fp2.hole_cards).toEqual(["Kc"]); // the null is filtered
  });
});
