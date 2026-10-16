import { describe, it, expect } from "vitest";
import {
  buildReplayFrames,
  streetFrameIndex,
  detectBigBlind,
  type ReplayHand,
} from "@/lib/tracker-poker/replayEngine";

const PLAYERS = [
  { player_id: "P1", seat_number: 1, display_name: "Alice", starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, display_name: "Bob", starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, display_name: "Cara", starting_stack: 10000 },
];

let order = 0;
const A = (player_id: string, action_type: string, action_amount: number, street = "preflop") => {
  order += 1;
  return { player_id, action_type, action_amount, street, action_order: order };
};

function hand(partial: Partial<ReplayHand>): ReplayHand {
  order = 0;
  return {
    hand_number: 1,
    button_seat: 1,
    community_cards: [],
    players: PLAYERS,
    actions: [],
    ...partial,
  };
}

describe("buildReplayFrames", () => {
  it.each([
    { seats: [2, 5, 9], button: 2, positions: ["BTN", "SB", "BB"] },
    { seats: [2, 5, 9], button: 9, positions: ["SB", "BB", "BTN"] },
    { seats: [2, 9], button: 9, positions: ["BB", "BTN/SB"] },
  ])("uses recorded occupied seats for replay positions: $seats / button $button", ({ seats, button, positions }) => {
    const h = hand({
      button_seat: button,
      players: seats.map((seat, index) => ({ ...PLAYERS[index], seat_number: seat })),
      actions: [A("P1", "fold", 0)],
    });
    for (const frame of buildReplayFrames(h)) {
      expect(frame.seats.map((seat) => seat.position)).toEqual(positions);
    }
    expect(h.players.map((player) => player.seat_number)).toEqual(seats);
  });

  it("produces N+1 frames (frame 0 = initial state)", () => {
    const h = hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100)] });
    const frames = buildReplayFrames(h);
    expect(frames).toHaveLength(3);
    expect(frames[0].index).toBe(0);
    expect(frames[0].latestAction).toBeNull();
    expect(frames[0].potSize).toBe(0);
    // Frame 0 = starting stacks untouched.
    expect(frames[0].seats.every((s) => s.chip_count === 10000)).toBe(true);
  });

  it("fold-walk: final pot excludes the uncalled part of the big blind", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "fold", 0),
        A("P2", "fold", 0),
      ],
    });
    const frames = buildReplayFrames(h);
    const final = frames[frames.length - 1];
    expect(final.potSize).toBe(100); // 50 matched + 50 matched; BB excess is returned
    const byId = Object.fromEntries(final.seats.map((s) => [s.player_id, s]));
    expect(byId.P1.is_folded).toBe(true);
    expect(byId.P2.is_folded).toBe(true);
    expect(byId.P3.is_folded).toBe(false);
    expect(byId.P2.chip_count).toBe(9950); // posted 50
    expect(byId.P3.chip_count).toBe(9900); // posted 100
  });

  it("board grows 0 -> 3 -> 4 -> 5 as streets advance", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c", "2h", "9s"],
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P3", "check", 0),
        A("P2", "bet", 200, "flop"),
        A("P3", "call", 200, "flop"),
        A("P2", "bet", 300, "turn"),
        A("P3", "call", 300, "turn"),
        A("P2", "check", 0, "river"),
        A("P3", "check", 0, "river"),
      ],
    });
    const frames = buildReplayFrames(h);
    const boardLen = (cards: string[]) => cards.filter(Boolean).length;
    // preflop frames → 0 cards
    expect(boardLen(frames[5].displayCards)).toBe(0); // after P3 check, still preflop
    // first flop action → 3 cards
    const firstFlop = frames.find((f) => f.currentStreet === "flop")!;
    expect(boardLen(firstFlop.displayCards)).toBe(3);
    const firstTurn = frames.find((f) => f.currentStreet === "turn")!;
    expect(boardLen(firstTurn.displayCards)).toBe(4);
    const firstRiver = frames.find((f) => f.currentStreet === "river")!;
    expect(boardLen(firstRiver.displayCards)).toBe(5);
    // displayCards always padded to 5 slots
    expect(frames[0].displayCards).toHaveLength(5);
  });

  it("running pot is monotonic and matches committed total at the end", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "raise", 300),
        A("P2", "call", 250),
        A("P3", "call", 200),
      ],
    });
    const frames = buildReplayFrames(h);
    const pots = frames.map((f) => f.potSize);
    for (let i = 1; i < pots.length; i++) expect(pots[i]).toBeGreaterThanOrEqual(pots[i - 1]);
    expect(pots[pots.length - 1]).toBe(50 + 100 + 300 + 250 + 200);
  });

  it("final showdown pot uses the distributable amount after an uncalled refund", () => {
    const h = hand({
      players: [
        { player_id: "P1", seat_number: 1, display_name: "A", starting_stack: 1000, hole_cards: ["2c", "3c"] },
        { player_id: "P2", seat_number: 2, display_name: "B", starting_stack: 1000, hole_cards: ["4d", "5d"] },
      ],
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      actions: [A("P1", "all_in", 300, "river"), A("P2", "call", 100, "river")],
    });
    const frames = buildReplayFrames(h);
    const final = frames.at(-1)!;
    expect(final.potBreakdown?.totalCommitted).toBe(400);
    expect(final.potBreakdown?.totalPot).toBe(200);
    expect(final.potBreakdown?.uncalled).toEqual({ player_id: "P1", amount: 200 });
    expect(final.potSize).toBe(200);
  });

  it("all-in flags the seat, stack hits 0, never negative", () => {
    const shortHand: ReplayHand = {
      hand_number: 1,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "P1", seat_number: 1, display_name: "Alice", starting_stack: 500 },
        { player_id: "P2", seat_number: 2, display_name: "Bob", starting_stack: 10000 },
      ],
      actions: [A("P1", "all_in", 500), A("P2", "call", 500)],
    };
    const final = buildReplayFrames(shortHand).at(-1)!;
    const p1 = final.seats.find((s) => s.player_id === "P1")!;
    expect(p1.is_all_in).toBe(true);
    expect(p1.chip_count).toBe(0);
    expect(final.seats.every((s) => s.chip_count >= 0)).toBe(true);
  });

  it("short all-in creates a side pot in the frame breakdown", () => {
    const h: ReplayHand = {
      hand_number: 1,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "P1", seat_number: 1, display_name: "A", starting_stack: 500 },
        { player_id: "P2", seat_number: 2, display_name: "B", starting_stack: 10000 },
        { player_id: "P3", seat_number: 3, display_name: "C", starting_stack: 10000 },
      ],
      actions: [A("P1", "all_in", 500), A("P2", "call", 1000), A("P3", "call", 1000)],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.potBreakdown?.mainPot).toBe(1500);
    expect(final.potBreakdown?.sidePots).toHaveLength(1);
    expect(final.potBreakdown?.sidePots[0].amount).toBe(1000);
  });

  it("hole cards reveal only on the final frame, not before", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c", "2h", "9s"],
      players: [
        { player_id: "P1", seat_number: 1, display_name: "A", starting_stack: 10000, hole_cards: ["Ah", "Ad"] },
        { player_id: "P2", seat_number: 2, display_name: "B", starting_stack: 10000, hole_cards: ["Kh", "Qs"] },
        { player_id: "P3", seat_number: 3, display_name: "C", starting_stack: 10000 },
      ],
      actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100), A("P1", "call", 100), A("P3", "fold", 0)],
    });
    const frames = buildReplayFrames(h);
    expect(frames[1].revealHoleCards).toBe(false);
    expect(frames[1].seats.every((s) => !s.hole_cards)).toBe(true);
    const final = frames.at(-1)!;
    expect(final.revealHoleCards).toBe(true);
    expect(final.currentStreet).toBe("showdown");
    expect(final.seats.find((s) => s.player_id === "P1")!.hole_cards).toEqual(["Ah", "Ad"]);
    // a player with no hole_cards stays hidden even on reveal
    expect(final.seats.find((s) => s.player_id === "P3")!.hole_cards).toBeUndefined();
  });

  it("no hole cards → no reveal, street stays at the last action's street", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c"],
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P3", "check", 0),
        A("P2", "bet", 200, "flop"),
        A("P1", "fold", 0, "flop"),
        A("P3", "fold", 0, "flop"),
      ],
    });
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.revealHoleCards).toBe(false);
    expect(final.currentStreet).toBe("flop");
  });

  it("position labels are assigned (BTN present)", () => {
    const h = hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100)] });
    const positions = buildReplayFrames(h)[0].seats.map((s) => s.position);
    expect(positions).toContain("BTN");
  });

  it("is deterministic — rebuilding yields identical frames", () => {
    const make = () =>
      hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100), A("P1", "raise", 300)] });
    expect(buildReplayFrames(make())).toEqual(buildReplayFrames(make()));
  });

  it("handles an empty action list (just the initial frame)", () => {
    const frames = buildReplayFrames(hand({ actions: [] }));
    expect(frames).toHaveLength(1);
    expect(frames[0].potSize).toBe(0);
  });

  it("uses the persisted pot only when the action stream is absent", () => {
    const frames = buildReplayFrames(hand({ actions: [], stored_pot_size: 5_000 }));
    expect(frames).toHaveLength(1);
    expect(frames[0].potSize).toBe(5_000);
    expect(frames[0].potBreakdown).toBeNull();
  });
});

describe("buildReplayFrames — settlement containment", () => {
  const withEnd = (): ReplayHand => ({
    hand_number: 1,
    button_seat: 1,
    community_cards: ["As", "Kd", "7c", "2h", "9s"],
    players: [
      { player_id: "W", seat_number: 1, display_name: "Winner", starting_stack: 10000, ending_stack: 20000, hole_cards: ["Ah", "Ad"] },
      { player_id: "L", seat_number: 2, display_name: "Loser", starting_stack: 10000, ending_stack: 0, hole_cards: ["Kh", "Qs"] },
    ],
    actions: [
      { player_id: "L", action_type: "all_in", action_amount: 10000, street: "preflop", action_order: 1 },
      { player_id: "W", action_type: "call", action_amount: 10000, street: "preflop", action_order: 2 },
    ],
  });

  it("never treats legacy ending-stack deltas as verified settlement proof", () => {
    const frames = buildReplayFrames(withEnd());
    expect(frames.every((frame) => frame.payoutVerified === false)).toBe(true);
    expect(frames.every((frame) => frame.potAwards?.length === 0)).toBe(true);
    const final = frames.at(-1)!;
    expect(final.showdownResult).toBeNull();
    expect(final.showdownWinnerIds).toEqual([]);
    expect(final.seats.every((seat) => seat.net_won == null && seat.pot_winner !== true)).toBe(true);
  });

  it("does not publish a Broadway chop reconstructed only in the client", () => {
    const h: ReplayHand = {
      hand_number: 8,
      button_seat: 1,
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 1000, ending_stack: 1000, hole_cards: ["2c", "3c"] },
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 1000, ending_stack: 1000, hole_cards: ["4d", "5d"] },
      ],
      actions: [
        { player_id: "A", action_type: "all_in", action_amount: 1000, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "call", action_amount: 1000, street: "preflop", action_order: 2 },
      ],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBeNull();
    expect(final.showdownWinnerIds).toEqual([]);
    expect(final.potAwards).toEqual([]);
    expect(final.payoutVerified).toBe(false);
    expect(final.seats.every((s) => s.pot_winner !== true && s.payout_award == null)).toBe(true);
  });

  it("keeps Hand #8's distributable pot visible but withholds unverified awards", () => {
    const h: ReplayHand = {
      hand_number: 8,
      button_seat: 1,
      community_cards: ["As", "Jd", "Qh", "Jh", "8h"],
      players: [
        { player_id: "limitless", seat_number: 1, display_name: "Limitless", starting_stack: 8_700_000, ending_stack: 8_700_000, hole_cards: ["Jc", "9d"] },
        { player_id: "kayhan", seat_number: 2, display_name: "Kayhan Mokri", starting_stack: 47_400_000, ending_stack: 47_400_000, hole_cards: ["Js", "Ts"] },
      ],
      actions: [
        { player_id: "limitless", action_type: "post_bb", action_amount: 200_000, street: "preflop", action_order: 1 },
        { player_id: "kayhan", action_type: "all_in", action_amount: 47_400_000, street: "preflop", action_order: 2 },
        { player_id: "limitless", action_type: "call", action_amount: 8_500_000, street: "preflop", action_order: 3 },
      ],
    };

    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBeNull();
    expect(final.potSize).toBe(17_400_000);
    expect(final.potBreakdown?.totalCommitted).toBe(56_100_000);
    expect(final.potBreakdown?.uncalled).toEqual({ player_id: "kayhan", amount: 38_700_000 });
    expect(final.payoutVerified).toBe(false);
    expect(final.potAwards).toEqual([]);
    expect(final.seats.every((seat) => seat.payout_award == null && seat.refund_award == null)).toBe(true);
  });

  it("blocks winner glow when edited cards disagree with the stored payout", () => {
    const h: ReplayHand = {
      hand_number: 8,
      button_seat: 1,
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 1000, ending_stack: 2000, hole_cards: ["2c", "3c"] },
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 1000, ending_stack: 0, hole_cards: ["4d", "5d"] },
      ],
      actions: [
        { player_id: "A", action_type: "all_in", action_amount: 1000, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "call", action_amount: 1000, street: "preflop", action_order: 2 },
      ],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBe("needs_resettle");
    expect(final.potAwards).toEqual([]);
    expect(final.seats.every((s) => s.pot_winner !== true)).toBe(true);
    expect(final.seats.every((s) => s.net_won == null)).toBe(true);
  });

  it("marks a non-tied payout mismatch as needs_resettle", () => {
    const h = withEnd();
    h.players = h.players.map((p) => p.player_id === "W" ? { ...p, ending_stack: 19_400 } : p);
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBe("needs_resettle");
    expect(final.payoutVerified).toBe(false);
    expect(final.potAwards).toEqual([]);
    expect(final.seats.every((s) => s.net_won == null && s.pot_winner !== true)).toBe(true);
  });

  it("a SHOWDOWN with no ending_stack stays null (engine can't evaluate hands)", () => {
    // Both players are still in at the end (all-in + call) → not a fold-win, so with
    // ending_stack stripped there is no way to know the winner → no glow.
    const h = withEnd();
    h.players = h.players.map((p) => ({ ...p, ending_stack: null }));
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.seats.every((s) => s.net_won == null)).toBe(true);
  });

  it("does not glow a fold winner without persisted ending stacks", () => {
    const h: ReplayHand = {
      hand_number: 1,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 10000 }, // bettor → winner, no ending_stack
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 10000 },
      ],
      actions: [
        { player_id: "A", action_type: "post_sb", action_amount: 50, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "post_bb", action_amount: 100, street: "preflop", action_order: 2 },
        { player_id: "A", action_type: "raise", action_amount: 250, street: "preflop", action_order: 3 }, // A contributes 50+250=300
        { player_id: "B", action_type: "fold", action_amount: 0, street: "preflop", action_order: 4 },
      ],
    };
    const frames = buildReplayFrames(h);
    // Strictly final-frame-only: no glow on any step before the last.
    expect(frames.slice(0, -1).every((f) => f.seats.every((s) => s.net_won == null))).toBe(true);
    expect(frames.at(-1)!.seats.every((s) => s.net_won == null && s.pot_winner !== true)).toBe(true);
    expect(frames.at(-1)!.potAwards).toEqual([]);
  });

  it("does not publish a fold-win award or refund from ending stacks alone", () => {
    const h: ReplayHand = {
      hand_number: 2,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 10000, ending_stack: 10100 },
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 10000, ending_stack: 9900 },
      ],
      actions: [
        { player_id: "A", action_type: "post_sb", action_amount: 50, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "post_bb", action_amount: 100, street: "preflop", action_order: 2 },
        { player_id: "A", action_type: "raise", action_amount: 250, street: "preflop", action_order: 3 },
        { player_id: "B", action_type: "fold", action_amount: 0, street: "preflop", action_order: 4 },
      ],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.potSize).toBe(200);
    expect(final.payoutVerified).toBe(false);
    expect(final.potAwards).toEqual([]);
    expect(final.seats.every((seat) => seat.net_won == null && seat.payout_award == null && seat.refund_award == null)).toBe(true);
  });

  it("projects a verified public settlement only on the final action frame", () => {
    const h = withEnd();
    h.publicSettlement = {
      schemaVersion: "settlement-outcome-v1",
      status: "verified",
      players: [
        { playerId: "W", potAward: 20_000, refund: 0, netDelta: 10_000 },
        { playerId: "L", potAward: 0, refund: 0, netDelta: -10_000 },
      ],
      pots: [{
        potId: "main-0",
        kind: "main",
        amount: 20_000,
        winnerIds: ["W"],
        allocations: [{ potId: "main-0", winnerId: "W", amount: 20_000 }],
      }],
      refunds: [],
      handRanks: [{
        playerId: "W",
        category: "three_of_a_kind",
        bestFive: ["Ah", "Ad", "As", "Kd", "9s"],
        kickers: ["K", "9"],
      }],
    };

    const frames = buildReplayFrames(h);
    expect(frames.slice(0, -1).every((frame) => frame.payoutVerified === false)).toBe(true);
    expect(frames.slice(0, -1).every((frame) => frame.seats.every((seat) => seat.pot_winner !== true))).toBe(true);

    const final = frames.at(-1)!;
    expect(final.payoutVerified).toBe(true);
    expect(final.showdownResult).toBe("winner");
    expect(final.showdownWinnerIds).toEqual(["W"]);
    expect(final.potAwards).toEqual([{ potIndex: 0, amount: 20_000, winnerPlayerIds: ["W"] }]);
    expect(final.seats.find((seat) => seat.player_id === "W")).toMatchObject({
      pot_winner: true,
      payout_award: 20_000,
      refund_award: 0,
      hand_rank: {
        category: "three_of_a_kind",
        best_five: ["Ah", "Ad", "As", "Kd", "9s"],
        kickers: ["K", "9"],
      },
    });
  });

  it("keeps chop awards and an uncalled refund separate at settlement", () => {
    const h: ReplayHand = {
      hand_number: 8,
      button_seat: 1,
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 1_000, hole_cards: ["2c", "3c"] },
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 1_500, hole_cards: ["4d", "5d"] },
      ],
      actions: [
        { player_id: "A", action_type: "all_in", action_amount: 1_000, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "call", action_amount: 1_500, street: "preflop", action_order: 2 },
      ],
      publicSettlement: {
        schemaVersion: "settlement-outcome-v1",
        status: "verified",
        players: [
          { playerId: "A", potAward: 1_000, refund: 0, netDelta: 0 },
          { playerId: "B", potAward: 1_000, refund: 500, netDelta: 0 },
        ],
        pots: [{
          potId: "main-0",
          kind: "main",
          amount: 2_000,
          winnerIds: ["A", "B"],
          allocations: [
            { potId: "main-0", winnerId: "A", amount: 1_000 },
            { potId: "main-0", winnerId: "B", amount: 1_000 },
          ],
        }],
        refunds: [{ playerId: "B", amount: 500, sourceActionId: "a2" }],
        handRanks: [
          { playerId: "A", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
          { playerId: "B", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
        ],
      },
    };

    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBe("chop");
    expect(final.seats.filter((seat) => seat.pot_winner)).toHaveLength(2);
    expect(final.seats.find((seat) => seat.player_id === "B")).toMatchObject({
      payout_award: 1_000,
      refund_award: 500,
    });
  });
});

describe("streetFrameIndex", () => {
  it("maps each present street to the frame it first appears on", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c", "2h", "9s"],
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P3", "check", 0),
        A("P2", "bet", 200, "flop"),
        A("P3", "call", 200, "flop"),
      ],
    });
    const frames = buildReplayFrames(h);
    const idx = streetFrameIndex(frames);
    expect(idx.preflop).toBe(0);
    expect(idx.flop).toBe(frames.find((f) => f.currentStreet === "flop")!.index);
    expect(idx.flop).toBeGreaterThan(idx.preflop);
  });
});

describe("detectBigBlind", () => {
  it("uses explicit big_blind when present", () => {
    expect(detectBigBlind(hand({ big_blind: 200, actions: [A("P3", "post_bb", 100)] }))).toBe(200);
  });
  it("falls back to the post_bb amount", () => {
    expect(detectBigBlind(hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100)] }))).toBe(100);
  });
  it("returns 0 when unknown", () => {
    expect(detectBigBlind(hand({ actions: [A("P1", "bet", 300)] }))).toBe(0);
  });
});
