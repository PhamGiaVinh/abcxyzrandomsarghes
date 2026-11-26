import { describe, expect, it } from "vitest";
import {
  computeAuthoritativeSettlement,
  normalizeSettlementSourceRpcResult,
  frozenBigBlindAntePlayerId,
  type AuthoritativeSettlementInput,
} from "@settlement/compute.ts";

const hand = (id: string, number: number, updated = `2026-07-12T00:00:0${number}.000Z`) => ({
  id,
  tournament_id: "tournament-1",
  hand_number: number,
  table_id: "table-1",
  button_seat: 2,
  community_cards: ["As", "Jd", "Qh", "Jh", "8h"],
  pot_size: 0,
  side_pots: [],
  status: "completed",
  is_voided: false,
  updated_at: updated,
  created_at: updated,
});

const action = (handId: string, id: string, playerId: string, type: string, amount: number, order: number) => ({
  id,
  hand_id: handId,
  player_id: playerId,
  entry_number: 1,
  street: "preflop",
  action_type: type,
  action_amount: amount,
  action_order: order,
});

function hand8Input(): AuthoritativeSettlementInput {
  return {
    tournamentId: "tournament-1",
    targetHandId: "hand-8",
    hands: [hand("hand-8", 8)],
    players: [
      { hand_id: "hand-8", player_id: "limitless", entry_number: 1, seat_number: 2, starting_stack: 8_700_000, ending_stack: 17_400_000, hole_cards: ["Jc", "9d"] },
      { hand_id: "hand-8", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 47_400_000, ending_stack: 38_700_000, hole_cards: ["Js", "Ts"] },
    ],
    actions: [
      action("hand-8", "h8-a1", "limitless", "post_sb", 50, 1),
      action("hand-8", "h8-a2", "kayhan", "post_bb", 100, 2),
      action("hand-8", "h8-a3", "limitless", "all_in", 8_699_950, 3),
      action("hand-8", "h8-a4", "kayhan", "all_in", 47_399_900, 4),
    ],
    liveStacks: [
      { player_id: "limitless", entry_number: 1, chip_count: 17_400_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 38_700_000 },
    ],
  };
}

describe("authoritative settlement computation", () => {
  it('requires a valid frozen BB position and matching ante before using the new rule',()=>{
    const input=hand8Input();
    expect(frozenBigBlindAntePlayerId(input.hands[0],input.players)).toBeUndefined();
    for(const invalid of [{tracker_bb_position:null,tracker_bba:200},{tracker_bb_position:10,tracker_bba:200},
      {tracker_bb_position:3,tracker_bba:0}]) {
      expect(()=>frozenBigBlindAntePlayerId({...input.hands[0],tracker_big_blind_ante_only:true,tracker_big_blind:200,...invalid},input.players))
        .toThrow('invalid_big_blind_ante_snapshot');
    }
  });
  it('recomputes a frozen BB ante hand without returning its ante as an uncalled wager',async()=>{
    const input=hand8Input();
    input.hands=[{...hand('hand-8',8),community_cards:[],pot_size:600,
      tracker_big_blind_ante_only:true,tracker_big_blind:200,tracker_bba:200,tracker_bb_position:3}];
    input.players=[
      {hand_id:'hand-8',player_id:'limitless',entry_number:1,seat_number:2,starting_stack:1000,ending_stack:1400,hole_cards:[]},
      {hand_id:'hand-8',player_id:'kayhan',entry_number:1,seat_number:3,starting_stack:1000,ending_stack:600,hole_cards:[]},
    ];
    input.actions=[action('hand-8','sb','limitless','post_sb',100,1),action('hand-8','ante','kayhan','post_ante',200,2),
      action('hand-8','bb','kayhan','post_bb',200,3),action('hand-8','call','limitless','call',100,4),
      action('hand-8','fold','kayhan','fold',0,5)];
    input.liveStacks=[{player_id:'limitless',entry_number:1,chip_count:1400},{player_id:'kayhan',entry_number:1,chip_count:600}];
    const result=await computeAuthoritativeSettlement(input);
    expect(result.publicOutcome.pots[0].amount).toBe(600);
    expect(result.publicOutcome.pots[0].allocations).toEqual([expect.objectContaining({winnerId:'limitless',amount:600})]);
  });
  it("awards an odd tied chip to the first winner strictly after the button", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 2 }];
    input.players = [
      { hand_id: "hand-8", player_id: "button", entry_number: 1, seat_number: 2, starting_stack: 5, ending_stack: 7, hole_cards: ["As", "Kd"] },
      { hand_id: "hand-8", player_id: "left", entry_number: 1, seat_number: 3, starting_stack: 5, ending_stack: 8, hole_cards: ["Ah", "Jd"] },
      { hand_id: "hand-8", player_id: "loser", entry_number: 1, seat_number: 4, starting_stack: 5, ending_stack: 0, hole_cards: ["Qs", "Qc"] },
    ];
    input.actions = [
      action("hand-8", "odd-a1", "left", "post_sb", 2, 1),
      action("hand-8", "odd-a2", "loser", "post_bb", 5, 2),
      action("hand-8", "odd-a3", "button", "call", 5, 3),
      action("hand-8", "odd-a4", "left", "call", 3, 4),
    ];
    input.edit = { communityCards: ["2c", "3d", "4h", "5s", "9c"], actions: input.actions };
    input.liveStacks = [
      { player_id: "button", entry_number: 1, chip_count: 7 },
      { player_id: "left", entry_number: 1, chip_count: 8 },
      { player_id: "loser", entry_number: 1, chip_count: 0 },
    ];

    const result = await computeAuthoritativeSettlement(input);
    expect(result.publicOutcome.pots[0].allocations).toEqual([
      { potId: "main-0", winnerId: "left", amount: 8, includesOddChip: true },
      { potId: "main-0", winnerId: "button", amount: 7, includesOddChip: false },
    ]);
  });

  it("awards an odd side-pot chip only among eligible tied winners", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 2 }];
    input.players = [
      { hand_id: "hand-8", player_id: "main", entry_number: 1, seat_number: 1, starting_stack: 1, ending_stack: 4, hole_cards: ["6s", "7s"] },
      { hand_id: "hand-8", player_id: "side-button", entry_number: 1, seat_number: 2, starting_stack: 2, ending_stack: 1, hole_cards: ["As", "Kd"] },
      { hand_id: "hand-8", player_id: "side-left", entry_number: 1, seat_number: 3, starting_stack: 2, ending_stack: 2, hole_cards: ["Ah", "Jd"] },
      { hand_id: "hand-8", player_id: "side-loser", entry_number: 1, seat_number: 4, starting_stack: 2, ending_stack: 0, hole_cards: ["Qs", "Qc"] },
    ];
    input.actions = [
      action("hand-8", "side-odd-a1", "side-left", "post_sb", 1, 1),
      action("hand-8", "side-odd-a2", "side-loser", "post_bb", 2, 2),
      action("hand-8", "side-odd-a3", "main", "all_in", 1, 3),
      action("hand-8", "side-odd-a4", "side-button", "all_in", 2, 4),
      action("hand-8", "side-odd-a5", "side-left", "call", 1, 5),
    ];
    input.edit = { communityCards: ["2c", "3d", "4h", "5s", "9c"], actions: input.actions };
    input.liveStacks = [
      { player_id: "main", entry_number: 1, chip_count: 4 },
      { player_id: "side-button", entry_number: 1, chip_count: 1 },
      { player_id: "side-left", entry_number: 1, chip_count: 2 },
      { player_id: "side-loser", entry_number: 1, chip_count: 0 },
    ];

    const result = await computeAuthoritativeSettlement(input);
    expect(result.publicOutcome.pots[1]).toMatchObject({
      kind: "side",
      allocations: [
        { potId: "side-1", winnerId: "side-left", amount: 2, includesOddChip: true },
        { potId: "side-1", winnerId: "side-button", amount: 1, includesOddChip: false },
      ],
    });
    expect(new Set(result.publicOutcome.pots[1].eligiblePlayerIds)).toEqual(
      new Set(["side-button", "side-left", "side-loser"]),
    );
  });

  it("matches a final stack by player and entry instead of player id alone", async () => {
    const input = hand8Input();
    input.liveStacks = [
      { player_id: "limitless", entry_number: 2, chip_count: 100_000_000 },
      { player_id: "limitless", entry_number: 1, chip_count: 17_400_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 38_700_000 },
    ];

    const result = await computeAuthoritativeSettlement(input);
    expect(result.finalStacks.find((row) => row.player_id === "limitless")).toMatchObject({
      player_id: "limitless",
      entry_number: 1,
      expected_current: 17_400_000,
    });

    const permuted = hand8Input();
    permuted.liveStacks = [...input.liveStacks].reverse();
    const permutedResult = await computeAuthoritativeSettlement(permuted);
    expect(permutedResult.finalStacks.find((row) => row.player_id === "limitless")).toMatchObject({
      player_id: "limitless",
      entry_number: 1,
      expected_current: 17_400_000,
    });
  });

  it("fails closed when only a newer re-entry stack exists", async () => {
    const input = hand8Input();
    input.liveStacks = [
      { player_id: "limitless", entry_number: 2, chip_count: 100_000_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 38_700_000 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("live_stack_missing:limitless#1");
  });

  it("does not carry a prior entry balance into a later re-entry", async () => {
    const input = hand8Input();
    input.hands = [hand("hand-8", 8), hand("hand-9", 9)];
    input.players = [
      ...input.players,
      { hand_id: "hand-9", player_id: "limitless", entry_number: 2, seat_number: 2, starting_stack: 1_000_000, ending_stack: 900_000, hole_cards: [] },
      { hand_id: "hand-9", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 38_700_000, ending_stack: 38_800_000, hole_cards: [] },
    ];
    input.actions = [
      ...input.actions,
      { ...action("hand-9", "h9-reentry-a1", "limitless", "bet", 100_000, 1), entry_number: 2 },
      action("hand-9", "h9-reentry-a2", "kayhan", "call", 100_000, 2),
    ];
    input.liveStacks = [
      { player_id: "limitless", entry_number: 1, chip_count: 17_400_000 },
      { player_id: "limitless", entry_number: 2, chip_count: 900_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 38_800_000 },
    ];

    const result = await computeAuthoritativeSettlement(input);
    expect(result.handChanges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ hand_id: "hand-9", player_id: "limitless", entry_number: 2 }),
    ]));
    expect(result.finalStacks.find((row) => row.player_id === "limitless" && row.entry_number === 2))
      .toMatchObject({ expected_current: 900_000, chip_count: 900_000 });
  });

  it("rejects duplicate live rows for the same entry", async () => {
    const input = hand8Input();
    input.liveStacks = [...input.liveStacks, { ...input.liveStacks[0] }];
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("live_stack_ambiguous:limitless#1");
  });
  it("settles Hand #8 as a chop with a separate uncalled refund", async () => {
    const result = await computeAuthoritativeSettlement(hand8Input());
    expect(result.privateOutcome.totals).toMatchObject({
      committedTotal: 56_100_000,
      distributablePot: 17_400_000,
      refundTotal: 38_700_000,
    });
    expect(result.privateOutcome.pots[0].winnerIds).toEqual(["kayhan", "limitless"]);
    expect(result.privateOutcome.pots[0].allocations.map((allocation) => allocation.amount)).toEqual([8_700_000, 8_700_000]);
    expect(result.privateOutcome.refunds).toEqual([{ playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a4" }]);
    expect(result.privateOutcome.players.map((player) => player.endingStack)).toEqual([8_700_000, 47_400_000]);
    expect(result.privateOutcome.handRanks.map((rank) => [rank.category, ...rank.kickers])).toEqual([
      ["trips", "A", "Q"],
      ["trips", "A", "Q"],
    ]);
    expect(result.publicOutcome.handRanks.every((rank) => rank.bestFive.length === 5)).toBe(true);
    expect(result.publicOutcome).not.toHaveProperty("privateEvidence");
  });

  it("settles a fold win without requiring showdown cards", async () => {
    const input = hand8Input();
    input.players = input.players.map((player) => ({ ...player, hole_cards: [] }));
    input.edit = {
      communityCards: [],
      actions: [
        action("hand-8", "fold-a", "limitless", "post_sb", 50, 1),
        action("hand-8", "fold-b", "kayhan", "post_bb", 100, 2),
        action("hand-8", "fold-c", "limitless", "fold", 0, 3),
      ],
    };
    input.liveStacks = input.liveStacks.map((stack) => stack.player_id === "limitless"
      ? { ...stack, chip_count: 17_300_000 }
      : { ...stack, chip_count: 47_400_000 });
    input.players = input.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_300_000 }
      : { ...player, ending_stack: 47_400_000 });
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.pots[0].winnerIds).toEqual(["kayhan"]);
    expect(result.privateOutcome.handRanks).toEqual([]);
  });

  it("propagates corrected stacks to a later hand", async () => {
    const input = hand8Input();
    input.hands = [hand("hand-8", 8), hand("hand-9", 9)];
    input.players = [
      ...input.players,
      { hand_id: "hand-9", player_id: "limitless", entry_number: 1, seat_number: 2, starting_stack: 17_400_000, ending_stack: 17_300_000, hole_cards: [] },
      { hand_id: "hand-9", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 38_700_000, ending_stack: 38_800_000, hole_cards: [] },
    ];
    input.actions = [
      ...input.actions,
      action("hand-9", "h9-a1", "limitless", "bet", 100, 1),
      action("hand-9", "h9-a2", "kayhan", "call", 100, 2),
    ];
    const result = await computeAuthoritativeSettlement(input);
    expect(result.handChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ hand_id: "hand-9", player_id: "limitless", starting_stack: 8_700_000, ending_stack: 8_600_000 }),
      expect.objectContaining({ hand_id: "hand-9", player_id: "kayhan", starting_stack: 47_400_000, ending_stack: 47_500_000 }),
    ]));
  });

  it("rejects an edited all-in amount that exceeds the player's stack", async () => {
    const input = hand8Input();
    input.actions = [
      action("hand-8", "bad-a1", "limitless", "post_sb", 4_350_000, 1),
      action("hand-8", "bad-a2", "kayhan", "post_bb", 8_700_000, 2),
      action("hand-8", "bad-a3", "limitless", "all_in", 17_400_001, 3),
    ];
    input.edit = { actions: input.actions };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:3:AMOUNT_MISMATCH");
  });

  it("replays edited actions with strict call amounts before settlement", async () => {
    const input = hand8Input();
    input.edit = {
      actions: [
        action("hand-8", "edited-a", "kayhan", "bet", 100, 1),
        action("hand-8", "edited-b", "limitless", "call", 50, 2),
      ],
    };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:2:AMOUNT_MISMATCH");
  });

  it("rejects an edited action from a seat that is not the server-derived actor", async () => {
    const input = hand8Input();
    input.edit = {
      actions: [
        action("hand-8", "edited-a", "limitless", "bet", 100, 1),
      ],
    };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:1:OUT_OF_TURN");
  });

  it("does not settle a valid but incomplete preflop prefix using synthetic showdown cards", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4 }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Kc", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Qc", "Qd"] },
    ];
    input.actions = [];
    input.edit = {
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
        action("hand-8", "hu-a1", "SB", "post_sb", 50, 1),
        action("hand-8", "hu-a2", "BB", "post_bb", 100, 2),
        action("hand-8", "hu-a3", "SB", "call", 50, 3),
      ],
    };
    // The fixture has no antes or dead money: only the explicit 50/100 blinds are committed.
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 900 },
      { player_id: "BB", entry_number: 1, chip_count: 900 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("incomplete_action_stream");
  });

  it("rejects an edited stream that acts out of turn on the flop", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4 }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Kc", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Qc", "Qd"] },
    ];
    input.edit = {
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
      action("hand-8", "hu-a1", "SB", "post_sb", 50, 1),
      action("hand-8", "hu-a2", "BB", "post_bb", 100, 2),
      action("hand-8", "hu-a3", "SB", "call", 50, 3),
      action("hand-8", "hu-a4", "BB", "check", 0, 4),
      { ...action("hand-8", "hu-a5", "SB", "check", 0, 5), street: "flop" },
      ],
    };
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 900 },
      { player_id: "BB", entry_number: 1, chip_count: 900 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:5:OUT_OF_TURN");
  });

  it("rejects duplicate cards across the board and hole-card set", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4, community_cards: [] }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 950, hole_cards: ["As", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 1_050, hole_cards: ["Qc", "Qd"] },
    ];
    input.actions = [];
    input.edit = {
      communityCards: ["As", "Jd", "Qh"],
      holeCards: [{ player_id: "SB", entry_number: 1, hole_cards: ["As", "Kd"] }],
      actions: [
        action("hand-8", "fold-a", "SB", "post_sb", 50, 1),
        action("hand-8", "fold-b", "BB", "post_bb", 100, 2),
        action("hand-8", "fold-c", "SB", "fold", 0, 3),
      ],
    };
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 950 },
      { player_id: "BB", entry_number: 1, chip_count: 1_050 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("invalid_card_set");
  });

  it("keeps a complete all-in runout settleable without betting actions on later streets", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4 }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 2_000, hole_cards: ["Kc", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 0, hole_cards: ["Qc", "Qd"] },
    ];
    input.actions = [];
    input.edit = {
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
        action("hand-8", "runout-a1", "SB", "post_sb", 50, 1),
        action("hand-8", "runout-a2", "BB", "post_bb", 100, 2),
        action("hand-8", "runout-a3", "SB", "all_in", 950, 3),
        action("hand-8", "runout-a4", "BB", "call", 900, 4),
      ],
    };
    // Ante and dead money are both zero; the pot is the 1,000-chip matched all-in.
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 2_000 },
      { player_id: "BB", entry_number: 1, chip_count: 0 },
    ];

    const result = await computeAuthoritativeSettlement(input);
    expect(result.winnerIds).toEqual(["SB"]);
    expect(result.privateOutcome.totals.committedTotal).toBe(2_000);
  });

  it("rejects invalid board cardinality without exposing card data", async () => {
    const input = hand8Input();
    input.edit = { communityCards: ["As", "Kd"] };

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("invalid_card_set");
  });

  it("validates the recorded action stream when only cards are edited", async () => {
    const input = hand8Input();
    input.actions = [
      action("hand-8", "bad-a1", "limitless", "post_sb", 4_350_000, 1),
      action("hand-8", "bad-a2", "kayhan", "post_bb", 8_700_000, 2),
      action("hand-8", "bad-a3", "limitless", "call", 4_350_000, 3),
    ];
    input.edit = { communityCards: ["As", "Jd", "Qh", "Jh", "8h"] };

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("incomplete_action_stream");
  });

  it("requires board cards for the highest betting street but keeps preflop fold-wins cardless", async () => {
    const missingFlop = hand8Input();
    missingFlop.actions = [
      action("hand-8", "flop-a1", "limitless", "post_sb", 50, 1),
      action("hand-8", "flop-a2", "kayhan", "post_bb", 100, 2),
      action("hand-8", "flop-a3", "limitless", "call", 50, 3),
      action("hand-8", "flop-a4", "kayhan", "check", 0, 4),
      { ...action("hand-8", "flop-a5", "kayhan", "check", 0, 5), street: "flop" },
    ];
    missingFlop.edit = { communityCards: [] };
    await expect(computeAuthoritativeSettlement(missingFlop)).rejects.toThrow("incomplete_board_for_street");

    const foldWin = hand8Input();
    foldWin.players = foldWin.players.map((player) => ({ ...player, hole_cards: [] }));
    foldWin.edit = {
      communityCards: [],
      actions: [
        action("hand-8", "cardless-a1", "limitless", "post_sb", 50, 1),
        action("hand-8", "cardless-a2", "kayhan", "post_bb", 100, 2),
        action("hand-8", "cardless-a3", "limitless", "fold", 0, 3),
      ],
    };
    foldWin.liveStacks = [
      { player_id: "limitless", entry_number: 1, chip_count: 17_300_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 47_400_000 },
    ];
    foldWin.players = foldWin.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_300_000 }
      : { ...player, ending_stack: 47_400_000 });
    await expect(computeAuthoritativeSettlement(foldWin)).resolves.toMatchObject({ winnerIds: ["kayhan"] });
  });

  it("uses the database revision consistently in the outcome and target source anchor", async () => {
    const input = hand8Input();
    input.hands = input.hands.map((value) => ({ ...value, source_revision: 7 }));
    input.sourceRevisionOverride = 7;
    input.sourceChainHashOverride = "a".repeat(64);
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.sourceRevision).toBe(7);
    expect(result.privateOutcome.privateEvidence.sourceChain[0].sourceRevision).toBe(7);
  });

  it("uses the server-selected correction revision for the persisted outcome", async () => {
    const input = hand8Input();
    input.settlementRevisionOverride = 4;
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.settlementRevision).toBe(4);
  });
});

describe("settlement source RPC normalization", () => {
  const sourceChainHash = "a".repeat(64);

  it("unwraps the single-row array returned by a RETURNS TABLE RPC", () => {
    expect(normalizeSettlementSourceRpcResult([{
      source_revision: 7,
      source_chain_hash: sourceChainHash,
      affected_hand_count: 2,
    }])).toEqual({ sourceRevision: 7, sourceChainHash });
  });

  it("rejects missing or malformed source evidence", () => {
    expect(() => normalizeSettlementSourceRpcResult([])).toThrow("invalid_settlement_source");
    expect(() => normalizeSettlementSourceRpcResult([{ source_revision: 0, source_chain_hash: sourceChainHash }]))
      .toThrow("invalid_settlement_source");
    expect(() => normalizeSettlementSourceRpcResult([{ source_revision: 1, source_chain_hash: "not-a-hash" }]))
      .toThrow("invalid_settlement_source");
  });
});
