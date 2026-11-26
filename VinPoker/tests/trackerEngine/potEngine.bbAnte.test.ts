import { describe, expect, it } from "vitest";
import * as server from "@tracker-engine/potEngine.ts";
import * as client from "@/lib/tracker-poker/potEngine";
import { buildReplayFrames, type ReplayHand } from "@/lib/tracker-poker/replayEngine";

describe.each([["server", server], ["display", client]] as const)("%s big blind ante pot accounting", (_name, engine) => {
  it("keeps a full BB ante in the main pot after equal live wagers", () => {
    const actions = [
      { player_id: "sb", action_type: "post_sb", action_amount: 100 },
      { player_id: "bb", action_type: "post_bb", action_amount: 200 },
      { player_id: "bb", action_type: "post_ante", action_amount: 200 },
      { player_id: "sb", action_type: "call", action_amount: 100 },
    ];
    const result = engine.computePotBreakdown(engine.contributionsFromActions(actions, "bb"));
    expect(result).toMatchObject({ totalCommitted: 600, mainPot: 600, sidePots: [], uncalled: null });
    expect(engine.computePotBreakdown(engine.contributionsFromActions(actions)).uncalled)
      .toEqual({ player_id: "bb", amount: 200 });
  });

  it("keeps a short BB's 100 ante out of side-pot eligibility", () => {
    const actions = [
      { player_id: "a", action_type: "post_sb", action_amount: 100 },
      { player_id: "bb", action_type: "post_bb", action_amount: 200 },
      { player_id: "bb", action_type: "post_ante", action_amount: 100 },
      { player_id: "b", action_type: "raise", action_amount: 500 },
      { player_id: "a", action_type: "call", action_amount: 300 },
    ];
    const result = engine.computePotBreakdown(engine.contributionsFromActions(actions, "bb"));
    expect(result).toMatchObject({
      totalCommitted: 1_200,
      mainPot: 700,
      totalPot: 1_100,
      uncalled: { player_id: "b", amount: 100 },
    });
    expect(result.pots[0].eligible_player_ids).toEqual(expect.arrayContaining(["a", "bb", "b"]));
    expect(result.sidePots).toEqual([{ amount: 400, eligible_player_ids: ["a", "b"] }]);
  });
});

it("shows a recorded short BB ante as dead chips only under the frozen BB-only rule", () => {
  const hand: ReplayHand = {
    hand_number: 1,
    button_seat: 1,
    community_cards: [],
    big_blind: 200,
    ante: 200,
    players: [
      { player_id: "sb", seat_number: 1, display_name: "SB", starting_stack: 1_000 },
      { player_id: "bb", seat_number: 2, display_name: "BB", starting_stack: 300 },
    ],
    actions: [
      { player_id: "sb", action_type: "post_sb", action_amount: 100 },
      { player_id: "bb", action_type: "post_bb", action_amount: 200 },
      { player_id: "bb", action_type: "post_ante", action_amount: 100 },
    ].map((action, index) => ({ ...action, street: "preflop", action_order: index + 1 })),
  };
  const current = buildReplayFrames({ ...hand, big_blind_ante_only: true }, { trackBets: true }).at(-1);
  const historical = buildReplayFrames(hand, { trackBets: true }).at(-1);
  expect(current?.seats.find(seat => seat.player_id === "bb")).toMatchObject({ chip_count: 0, current_bet: 200 });
  expect(current?.potBreakdown?.uncalled).toEqual({ player_id: "bb", amount: 100 });
  expect(historical?.seats.find(seat => seat.player_id === "bb")).toMatchObject({ chip_count: 0, current_bet: 300 });
  expect(historical?.potBreakdown?.uncalled).toEqual({ player_id: "bb", amount: 200 });
});
