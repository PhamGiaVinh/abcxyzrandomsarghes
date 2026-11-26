import { canonicalJsonV1 } from "./outcomeV1.ts";
import { compareRankVec, evaluateBest } from "../pokerEngine/evaluate.ts";
import type { Card } from "../pokerEngine/types.ts";
import { computePotBreakdown, contributionsFromActions, toSidePotsJson } from "../trackerEngine/potEngine.ts";

export type VoiceFinishPlayer = {
  player_id: string;
  entry_number: number;
  seat_number: number;
  starting_stack: number;
  hole_cards: string[] | null;
  player_name?: string | null;
};

export type VoiceFinishAction = {
  player_id: string;
  entry_number: number;
  street: string;
  action_type: string;
  action_amount: number | null;
  action_order: number;
};

export type VoiceFinishInput = {
  handId: string;
  stateVersion: string;
  buttonSeat: number;
  communityCards: string[];
  players: readonly VoiceFinishPlayer[];
  actions: readonly VoiceFinishAction[];
  bettingComplete: boolean;
  /** Resolved from the frozen hand and participant snapshot by the server. */
  bigBlindAntePlayerId?: string;
};

export type VoiceFinishSettlement = {
  settlementOrigin: "engine_fold_win" | "engine_showdown";
  settlementDigest: string;
  actionStreamDigest: string;
  holeCardsDigest: string;
  sidePotsDigest: string;
  recordPlayers: Array<{
    player_id: string;
    entry_number: number;
    seat_number: number;
    starting_stack: number;
    ending_stack: number;
    is_eliminated: boolean;
    side_pots: [];
    hole_cards: string[];
  }>;
  recordActions: VoiceFinishAction[];
  sidePots: ReturnType<typeof toSidePotsJson>;
  potSize: number;
  summary: {
    winners: Array<{ player_id: string; seat_number: number; player_name: string | null; amount: number }>;
    pots: Array<{ kind: "main" | "side"; amount: number; winner_ids: string[] }>;
    ending_stacks: Array<{ player_id: string; seat_number: number; amount: number }>;
    conservation_total: number;
  };
};

function requireChip(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`invalid_chip:${label}`);
  return value as number;
}

function clockwise<T extends { seat_number: number }>(players: readonly T[], buttonSeat: number): T[] {
  return [...players].sort((left, right) => {
    const leftDistance = (left.seat_number - buttonSeat + 10) % 10;
    const rightDistance = (right.seat_number - buttonSeat + 10) % 10;
    return leftDistance - rightDistance || left.seat_number - right.seat_number;
  });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonV1(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Settles one persisted in-progress hand for the Voice Finish Assist path.
 * It shares the server pot/evaluator modules and deliberately accepts no
 * browser-supplied winner, stack, pot, or card result.
 */
export async function computeVoiceFinishSettlement(input: VoiceFinishInput): Promise<VoiceFinishSettlement> {
  const players = [...input.players].sort((left, right) => left.seat_number - right.seat_number || left.player_id.localeCompare(right.player_id));
  const actions = [...input.actions].sort((left, right) => left.action_order - right.action_order || left.player_id.localeCompare(right.player_id));
  if (players.length === 0 || new Set(players.map((player) => `${player.player_id}:${player.entry_number}`)).size !== players.length) {
    throw new Error("finish_player_snapshot_invalid");
  }
  if (new Set(actions.map((action) => action.action_order)).size !== actions.length) throw new Error("finish_action_snapshot_invalid");

  const cards = [
    ...input.communityCards,
    ...players.flatMap((player) => player.hole_cards ?? []),
  ];
  if (new Set(cards).size !== cards.length) throw new Error("finish_duplicate_card");

  const contributions = contributionsFromActions(actions, input.bigBlindAntePlayerId);
  const contributionByPlayer = new Map(contributions.map((row) => [row.player_id, row]));
  for (const player of players) {
    const committed = contributionByPlayer.get(player.player_id)?.total_bet ?? 0;
    if (committed > requireChip(player.starting_stack, `${player.player_id}.starting_stack`)) {
      throw new Error("finish_action_exceeds_stack");
    }
  }
  const breakdown = computePotBreakdown(contributions);
  if (breakdown.pots.length === 0) throw new Error("finish_empty_pot");
  const folded = new Set(contributions.filter((row) => row.is_folded).map((row) => row.player_id));
  const live = players.filter((player) => !folded.has(player.player_id));
  if (live.length === 0) throw new Error("finish_no_live_player");

  const settlementOrigin = live.length === 1 ? "engine_fold_win" as const : "engine_showdown" as const;
  if (settlementOrigin === "engine_showdown") {
    if (!input.bettingComplete || input.communityCards.length !== 5 || live.some((player) => (player.hole_cards ?? []).length !== 2)) {
      throw new Error("finish_requires_manual_showdown");
    }
  }

  // Pot awards decide the published winners. Uncalled refunds only restore a
  // player's own chips and must not turn a refund-only player into a winner.
  const awards = new Map<string, number>();
  const potAwards = new Map<string, number>();
  const pots: VoiceFinishSettlement["summary"]["pots"] = [];
  for (const [index, pot] of breakdown.pots.entries()) {
    const eligible = players.filter((player) => pot.eligible_player_ids.includes(player.player_id) && !folded.has(player.player_id));
    if (eligible.length === 0) throw new Error("finish_pot_without_eligible_player");
    let winners = eligible;
    if (settlementOrigin === "engine_showdown" && eligible.length > 1) {
      const ranked = eligible.map((player) => ({
        player,
        rank: evaluateBest([...(player.hole_cards ?? []), ...input.communityCards] as Card[]).rankVec,
      }));
      const best = ranked.reduce((current, candidate) => compareRankVec(candidate.rank, current) > 0 ? candidate.rank : current, ranked[0].rank);
      winners = ranked.filter((candidate) => compareRankVec(candidate.rank, best) === 0).map((candidate) => candidate.player);
    }
    const ordered = clockwise(winners, input.buttonSeat);
    const share = Math.floor(pot.amount / ordered.length);
    const odd = pot.amount - share * ordered.length;
    for (const [winnerIndex, winner] of ordered.entries()) {
      const amount = share + (winnerIndex < odd ? 1 : 0);
      awards.set(winner.player_id, (awards.get(winner.player_id) ?? 0) + amount);
      potAwards.set(winner.player_id, (potAwards.get(winner.player_id) ?? 0) + amount);
    }
    pots.push({ kind: index === 0 ? "main" : "side", amount: pot.amount, winner_ids: ordered.map((winner) => winner.player_id) });
  }

  if (breakdown.uncalled) {
    awards.set(
      breakdown.uncalled.player_id,
      (awards.get(breakdown.uncalled.player_id) ?? 0) + breakdown.uncalled.amount,
    );
  }
  const recordPlayers = players.map((player) => {
    const committed = contributionByPlayer.get(player.player_id)?.total_bet ?? 0;
    const ending = requireChip(player.starting_stack, `${player.player_id}.starting_stack`) - committed + (awards.get(player.player_id) ?? 0);
    if (ending < 0) throw new Error("finish_negative_ending_stack");
    return {
      player_id: player.player_id,
      entry_number: player.entry_number,
      seat_number: player.seat_number,
      starting_stack: player.starting_stack,
      ending_stack: ending,
      is_eliminated: ending === 0,
      side_pots: [] as [],
      hole_cards: [...(player.hole_cards ?? [])],
    };
  });
  const startingTotal = recordPlayers.reduce((total, player) => total + player.starting_stack, 0);
  const endingTotal = recordPlayers.reduce((total, player) => total + player.ending_stack, 0);
  if (startingTotal !== endingTotal) throw new Error("finish_chip_conservation_failed");

  const actionStreamDigest = await sha256(actions.map((action) => ({
    player_id: action.player_id,
    entry_number: action.entry_number,
    street: action.street,
    action_type: action.action_type,
    action_amount: action.action_amount ?? 0,
    action_order: action.action_order,
  })));
  const holeCardsDigest = await sha256(players.map((player) => ({
    player_id: player.player_id,
    entry_number: player.entry_number,
    hole_cards: player.hole_cards ?? [],
  })));
  const sidePots = toSidePotsJson(breakdown);
  const sidePotsDigest = await sha256(sidePots);
  const snapshot = {
    hand_id: input.handId,
    state_version: input.stateVersion,
    settlement_origin: settlementOrigin,
    board: [...input.communityCards],
    action_stream_digest: actionStreamDigest,
    hole_cards_digest: holeCardsDigest,
    side_pots_digest: sidePotsDigest,
    ending_stacks: recordPlayers.map((player) => ({ player_id: player.player_id, amount: player.ending_stack })),
    conservation_total: startingTotal,
  };
  const settlementDigest = await sha256(snapshot);
  const winners = players
    .filter((player) => (potAwards.get(player.player_id) ?? 0) > 0)
    .map((player) => ({
      player_id: player.player_id,
      seat_number: player.seat_number,
      player_name: player.player_name ?? null,
      amount: potAwards.get(player.player_id) ?? 0,
    }));

  return {
    settlementOrigin,
    settlementDigest,
    actionStreamDigest,
    holeCardsDigest,
    sidePotsDigest,
    recordPlayers,
    recordActions: actions,
    sidePots,
    potSize: breakdown.totalPot,
    summary: {
      winners,
      pots,
      ending_stacks: recordPlayers.map((player) => ({ player_id: player.player_id, seat_number: player.seat_number, amount: player.ending_stack })),
      conservation_total: startingTotal,
    },
  };
}
