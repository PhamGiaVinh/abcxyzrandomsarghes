// DEV-ONLY deterministic ReplayHand fixtures for the /__dev/livefelt harness.
// Pure data — no Supabase, no hooks, no real tournament/player names. The builder
// pattern mirrors tests/trackerPoker/replayEngine.test.ts (module-local there, so
// replicated here). Stacks/blinds echo the owner's problem screenshot scale
// (100k/200k blinds, multi-million stacks) so formatStack/BB display is realistic.

import type { ReplayHand, ReplayHandAction, ReplayHandPlayer } from "@/lib/tracker-poker/replayEngine";

export type LiveFeltFixtureName =
  | "verified-bba-jj"
  | "verified-sidepots"
  | "verified-fold"
  | "fold-walk"
  | "showdown"
  | "allin-sidepots"
  | "best-five-quads"
  | "board-plays"
  | "chop";

const BB = 200_000;
const SB = 100_000;

// 9-player pool; `seats` picks the first N. Ascending-ish varied stacks so the
// all-in fixture produces layered side pots (Main + Side 1..4 at 9-max).
const POOL: ReplayHandPlayer[] = [
  { player_id: "fx1", seat_number: 1, display_name: "b1a530", starting_stack: 2_900_000 },
  { player_id: "fx2", seat_number: 2, display_name: "9ec858", starting_stack: 5_400_000 },
  { player_id: "fx3", seat_number: 3, display_name: "9f9f8b", starting_stack: 8_500_000 },
  { player_id: "fx4", seat_number: 4, display_name: "9f0ef6", starting_stack: 10_300_000 },
  { player_id: "fx5", seat_number: 5, display_name: "dbbd59", starting_stack: 13_500_000 },
  { player_id: "fx6", seat_number: 6, display_name: "bcd9c1", starting_stack: 15_000_000 },
  { player_id: "fx7", seat_number: 7, display_name: "7480a0", starting_stack: 18_000_000 },
  { player_id: "fx8", seat_number: 8, display_name: "8be84c", starting_stack: 21_600_000 },
  { player_id: "fx9", seat_number: 9, display_name: "c45534", starting_stack: 35_400_000 },
];

const BOARD = ["As", "Kd", "7c", "7h", "2s"];
const HOLES: Record<string, string[]> = {
  fx1: ["Ah", "Ad"],
  fx2: ["Kc", "Kh"],
  fx3: ["Qs", "Qd"],
  fx4: ["Jc", "Jh"],
  fx5: ["Ts", "Td"],
};

function players(seats: number): ReplayHandPlayer[] {
  const n = Math.max(3, Math.min(9, seats));
  return POOL.slice(0, n).map((p) => ({ ...p }));
}

/** Sequential action builder (fresh order counter per fixture). */
function actionScript() {
  let order = 0;
  return (player_id: string, action_type: string, action_amount: number, street = "preflop"): ReplayHandAction => ({
    player_id,
    action_type,
    action_amount,
    street,
    action_order: ++order,
  });
}

/** Blinds + everyone folds to the SB → BB wins without showdown. */
function foldWalk(seats: number): ReplayHand {
  const ps = players(seats);
  const A = actionScript();
  const acts: ReplayHandAction[] = [A(ps[1].player_id, "post_sb", SB), A(ps[2 % ps.length].player_id, "post_bb", BB)];
  for (let i = 3; i < ps.length; i++) acts.push(A(ps[i].player_id, "fold", 0));
  acts.push(A(ps[0].player_id, "fold", 0));
  acts.push(A(ps[1].player_id, "fold", 0)); // SB folds too → BB walks
  return { hand_number: 101, button_seat: 1, community_cards: [], big_blind: BB, players: ps, actions: acts };
}

/** Two players see a full board and show down; the rest fold preflop. */
function showdown(seats: number): ReplayHand {
  const ps = players(seats);
  const A = actionScript();
  const hero = ps[0]; // fx1 (AA)
  const vill = ps[1]; // fx2 (KK)
  const acts: ReplayHandAction[] = [A(vill.player_id, "post_sb", SB), A(ps[2 % ps.length].player_id, "post_bb", BB)];
  for (let i = 3; i < ps.length; i++) acts.push(A(ps[i].player_id, "fold", 0));
  acts.push(A(hero.player_id, "raise", 3 * BB));
  acts.push(A(vill.player_id, "call", 3 * BB - SB));
  acts.push(A(ps[2 % ps.length].player_id, "fold", 0));
  acts.push(A(vill.player_id, "check", 0, "flop"));
  acts.push(A(hero.player_id, "bet", 800_000, "flop"));
  acts.push(A(vill.player_id, "call", 800_000, "flop"));
  acts.push(A(vill.player_id, "check", 0, "turn"));
  acts.push(A(hero.player_id, "bet", 2_000_000, "turn"));
  acts.push(A(vill.player_id, "call", 2_000_000, "turn"));
  acts.push(A(vill.player_id, "check", 0, "river"));
  acts.push(A(hero.player_id, "check", 0, "river"));
  // Pot = BB(dead) + 2×(3BB + 800k + 2M) = 200k + 2×3.4M = 7.0M → hero (+3.6M net).
  const pot = BB + 2 * (3 * BB + 800_000 + 2_000_000);
  const withCards = ps.map((p) =>
    p.player_id === hero.player_id
      ? { ...p, hole_cards: HOLES.fx1, ending_stack: p.starting_stack - (3 * BB + 800_000 + 2_000_000) + pot }
      : p.player_id === vill.player_id
        ? { ...p, hole_cards: HOLES.fx2, ending_stack: p.starting_stack - (3 * BB + 800_000 + 2_000_000) }
        : p
  );
  return {
    hand_number: 102,
    button_seat: 1,
    community_cards: BOARD,
    big_blind: BB,
    players: withCards,
    actions: acts,
    publicSettlement: {
      schemaVersion: "settlement-outcome-v1",
      status: "verified",
      players: ps.map((player, index) => ({
        playerId: player.player_id,
        potAward: index === 0 ? pot : 0,
        refund: 0,
        netDelta: index === 0 ? pot - 3_400_000 : index === 1 ? -3_400_000 : index === 2 ? -BB : 0,
      })),
      pots: [{
        potId: "main-0",
        kind: "main",
        amount: pot,
        winnerIds: [hero.player_id],
        allocations: [{ potId: "main-0", winnerId: hero.player_id, amount: pot }],
      }],
      refunds: [],
      handRanks: [
        {
          playerId: hero.player_id,
          category: "full_house",
          bestFive: ["Ah", "Ad", "As", "7c", "7h"],
          kickers: [],
        },
        {
          playerId: vill.player_id,
          category: "full_house",
          bestFive: ["Kc", "Kh", "Kd", "7c", "7h"],
          kickers: [],
        },
      ],
    },
  };
}

/** Multi-way all-in with layered side pots: at 9-max, 5 ascending all-in stacks
 *  produce Main + Side 1–4 (the owner-screenshot shape); at 6 → 3 layers; at 3 → 2. */
function allinSidepots(seats: number): ReplayHand {
  const ps = players(seats);
  const A = actionScript();
  const allinCount = ps.length >= 9 ? 5 : ps.length >= 6 ? 3 : ps.length; // ascending stacks 1..k
  const acts: ReplayHandAction[] = [A(ps[1].player_id, "post_sb", SB), A(ps[2 % ps.length].player_id, "post_bb", BB)];
  // Non-all-in seats fold first (UTG onward), then seats 1..k jam ascending.
  for (let i = allinCount; i < ps.length; i++) {
    if (i === 1 || i === 2) continue; // blinds act at the end of the script
    acts.push(A(ps[i].player_id, "fold", 0));
  }
  for (let i = 0; i < allinCount; i++) {
    const p = ps[i];
    const already = i === 1 ? SB : i === 2 ? BB : 0; // blinds already posted
    acts.push(A(p.player_id, "all_in", p.starting_stack - already));
  }
  if (allinCount < 2 || (allinCount <= 2 && ps.length > 2)) {
    // degenerate guard (never hit with seats>=3): keep the shape valid
  }
  const withCards = ps.map((p, i) => (i < allinCount ? { ...p, hole_cards: HOLES[p.player_id] ?? ["2c", "3d"] } : p));
  return { hand_number: 103, button_seat: ps.length, community_cards: BOARD, big_blind: BB, players: withCards, actions: acts };
}

function bestFiveQuads(): ReplayHand {
  return {
    hand_id: "fixture-best-five-quads",
    hand_number: 1,
    button_seat: 2,
    community_cards: ["Kh", "Jc", "Qh", "Ah", "Js"],
    big_blind: 200,
    players: [
      { player_id: "tom", seat_number: 1, display_name: "Tom Dwan", starting_stack: 10_000, ending_stack: 20_000, hole_cards: ["Jd", "Jh"] },
      { player_id: "phil", seat_number: 2, display_name: "Phil Ivey", starting_stack: 15_000, ending_stack: 5_000, hole_cards: ["Qd", "As"] },
    ],
    actions: [
      { action_id: "fixture-quads-a1", player_id: "phil", street: "preflop", action_type: "all_in", action_amount: 15_000, action_order: 1 },
      { action_id: "fixture-quads-a2", player_id: "tom", street: "preflop", action_type: "call", action_amount: 10_000, action_order: 2 },
    ],
    publicSettlement: {
      schemaVersion: "settlement-outcome-v1",
      status: "verified",
      players: [
        { playerId: "tom", potAward: 20_000, refund: 0, netDelta: 10_000 },
        { playerId: "phil", potAward: 0, refund: 5_000, netDelta: -10_000 },
      ],
      pots: [{
        potId: "main-0",
        kind: "main",
        amount: 20_000,
        winnerIds: ["tom"],
        allocations: [{ potId: "main-0", winnerId: "tom", amount: 20_000 }],
      }],
      refunds: [{ playerId: "phil", amount: 5_000, sourceActionId: "fixture-quads-a1" }],
      handRanks: [{
        playerId: "tom",
        category: "quads",
        bestFive: ["Jd", "Jh", "Jc", "Js", "Ah"],
        kickers: ["A"],
      }],
    },
  };
}

function boardPlays(): ReplayHand {
  const board = ["As", "Kd", "Qc", "Jh", "Ts"];
  return {
    hand_id: "fixture-board-plays",
    hand_number: 2,
    button_seat: 1,
    community_cards: board,
    big_blind: 100,
    players: [
      { player_id: "alice", seat_number: 1, display_name: "Alice", starting_stack: 1_000, ending_stack: 1_200, hole_cards: ["2c", "3c"] },
      { player_id: "bob", seat_number: 2, display_name: "Bob", starting_stack: 1_000, ending_stack: 800, hole_cards: ["4d", "5d"] },
    ],
    actions: [
      { action_id: "fixture-board-a1", player_id: "alice", street: "preflop", action_type: "post_sb", action_amount: 100, action_order: 1 },
      { action_id: "fixture-board-a2", player_id: "bob", street: "preflop", action_type: "post_bb", action_amount: 200, action_order: 2 },
      { action_id: "fixture-board-a3", player_id: "bob", street: "preflop", action_type: "fold", action_amount: 0, action_order: 3 },
    ],
    publicSettlement: {
      schemaVersion: "settlement-outcome-v1",
      status: "verified",
      players: [
        { playerId: "alice", potAward: 300, refund: 0, netDelta: 200 },
        { playerId: "bob", potAward: 0, refund: 0, netDelta: -200 },
      ],
      pots: [{
        potId: "main-0",
        kind: "main",
        amount: 300,
        winnerIds: ["alice"],
        allocations: [{ potId: "main-0", winnerId: "alice", amount: 300 }],
      }],
      refunds: [],
      handRanks: [{ playerId: "alice", category: "straight", bestFive: board, kickers: [] }],
    },
  };
}

function chop(): ReplayHand {
  const board = ["As", "Kd", "Qc", "Jh", "Ts"];
  return {
    hand_id: "fixture-chop",
    hand_number: 3,
    button_seat: 1,
    community_cards: board,
    big_blind: 100,
    players: [
      { player_id: "alice", seat_number: 1, display_name: "Alice", starting_stack: 1_000, ending_stack: 1_000, hole_cards: ["2c", "3c"] },
      { player_id: "bob", seat_number: 2, display_name: "Bob", starting_stack: 1_000, ending_stack: 1_000, hole_cards: ["4d", "5d"] },
    ],
    actions: [
      { action_id: "fixture-chop-a1", player_id: "alice", street: "preflop", action_type: "all_in", action_amount: 1_000, action_order: 1 },
      { action_id: "fixture-chop-a2", player_id: "bob", street: "preflop", action_type: "call", action_amount: 1_000, action_order: 2 },
    ],
    publicSettlement: {
      schemaVersion: "settlement-outcome-v1",
      status: "verified",
      players: [
        { playerId: "alice", potAward: 1_000, refund: 0, netDelta: 0 },
        { playerId: "bob", potAward: 1_000, refund: 0, netDelta: 0 },
      ],
      pots: [{
        potId: "main-0",
        kind: "main",
        amount: 2_000,
        winnerIds: ["alice", "bob"],
        allocations: [
          { potId: "main-0", winnerId: "alice", amount: 1_000 },
          { potId: "main-0", winnerId: "bob", amount: 1_000 },
        ],
      }],
      refunds: [],
      handRanks: [
        { playerId: "alice", category: "straight", bestFive: board, kickers: [] },
        { playerId: "bob", category: "straight", bestFive: board, kickers: [] },
      ],
    },
  };
}

function verifiedSidepots(): ReplayHand {
  const base = bestFiveQuads();
  return { ...base, hand_id: "fixture-verified-sidepots",
    players: [
      { ...base.players[0], ending_stack: 30_000 },
      { ...base.players[1], ending_stack: 10_000 },
      { player_id: "sam", display_name: "Sam", seat_number: 7, starting_stack: 15_000, ending_stack: 0, hole_cards: ["9s", "8s"] },
    ],
    actions: [...base.actions, { player_id: "sam", action_type: "call", street: "preflop", action_amount: 15_000, action_order: 3 }],
    publicSettlement: { schemaVersion: "settlement-outcome-v1", status: "verified",
      players: [{ playerId: "tom", potAward: 30_000, refund: 0, netDelta: 20_000 },
        { playerId: "phil", potAward: 10_000, refund: 0, netDelta: -5_000 },
        { playerId: "sam", potAward: 0, refund: 0, netDelta: -15_000 }],
      pots: [{ potId: "main-0", kind: "main", amount: 30_000, winnerIds: ["tom"], allocations: [{ potId: "main-0", winnerId: "tom", amount: 30_000 }] },
        { potId: "side-1", kind: "side", amount: 10_000, winnerIds: ["phil"], allocations: [{ potId: "side-1", winnerId: "phil", amount: 10_000 }] }],
      refunds: [], handRanks: [base.publicSettlement!.handRanks[0],
        { playerId: "phil", category: "two_pair", bestFive: ["As", "Ah", "Jc", "Js", "Kh"], kickers: ["K"] }],
    },
  };
}
function verifiedBbaJacks(seats: number): ReplayHand {
  const base = bestFiveQuads();
  const observers = Array.from({ length: Math.max(0, seats - base.players.length) }, (_, index) => ({
    player_id: `test-${index + 3}`, display_name: `TEST ${index + 3}`, seat_number: index + 3,
    starting_stack: 10000, ending_stack: 10000,
  }));
  return { ...base, hand_id: "fixture-bba-jj", button_seat: 1, small_blind: 100, ante: 200,
    big_blind_ante_only: true,
    players: [...base.players.map(p => ({ ...p, starting_stack: p.player_id === "tom" ? 10000 : 10200, ending_stack: p.player_id === "tom" ? 20200 : 0 })), ...observers],
    actions: [
      { player_id: "tom", action_type: "post_sb", action_amount: 100 },
      { player_id: "phil", action_type: "post_ante", action_amount: 200 },
      { player_id: "phil", action_type: "post_bb", action_amount: 200 },
      ...observers.map(player => ({ player_id: player.player_id, action_type: "fold", action_amount: 0 })),
      { player_id: "tom", action_type: "all_in", action_amount: 9900 },
      { player_id: "phil", action_type: "call", action_amount: 9800 },
    ].map((a, i) => ({ ...a, street: "preflop", action_order: i + 1 })),
    publicSettlement: { ...base.publicSettlement!, refunds: [],
      players: [{ playerId: "tom", potAward: 20200, refund: 0, netDelta: 10200 }, { playerId: "phil", potAward: 0, refund: 0, netDelta: -10200 },
        ...observers.map(player => ({ playerId: player.player_id, potAward: 0, refund: 0, netDelta: 0 }))],
      pots: [{ potId: "main-0", kind: "main", amount: 20200, winnerIds: ["tom"], allocations: [{ potId: "main-0", winnerId: "tom", amount: 20200 }] }],
    },
  };
}

function verifiedFold(): ReplayHand {
  const base = bestFiveQuads();
  return { ...base, hand_id: "fixture-verified-fold", community_cards: ["Kh", "Jc", "Qh"],
    players: base.players.map(p => ({ ...p, hole_cards: undefined, ending_stack: p.player_id === "tom" ? 9_800 : 15_200 })),
    actions: [
      { player_id: "tom", action_type: "post_sb", street: "preflop", action_amount: 100, action_order: 1 },
      { player_id: "phil", action_type: "post_bb", street: "preflop", action_amount: 200, action_order: 2 },
      { player_id: "tom", action_type: "call", street: "preflop", action_amount: 100, action_order: 3 },
      { player_id: "phil", action_type: "bet", street: "flop", action_amount: 1_000, action_order: 4 },
      { player_id: "tom", action_type: "fold", street: "flop", action_amount: 0, action_order: 5 },
    ],
    publicSettlement: { schemaVersion: "settlement-outcome-v1", status: "verified",
      players: [{ playerId: "tom", potAward: 0, refund: 0, netDelta: -200 }, { playerId: "phil", potAward: 400, refund: 1_000, netDelta: 200 }],
      pots: [{ potId: "main-0", kind: "main", amount: 400, winnerIds: ["phil"], allocations: [{ potId: "main-0", winnerId: "phil", amount: 400 }] }],
      refunds: [{ playerId: "phil", amount: 1_000, sourceActionId: "refund-phil" }], handRanks: [],
    },
  };
}

export function buildFixtureHand(name: LiveFeltFixtureName, seats: number): ReplayHand {
  switch (name) {
    case "verified-bba-jj": return verifiedBbaJacks(seats);
    case "verified-sidepots": return verifiedSidepots();
    case "verified-fold": return verifiedFold();
    case "fold-walk":
      return foldWalk(seats);
    case "showdown":
      return showdown(seats);
    case "allin-sidepots":
      return allinSidepots(seats);
    case "best-five-quads":
      return bestFiveQuads();
    case "board-plays":
      return boardPlays();
    case "chop":
      return chop();
  }
}
