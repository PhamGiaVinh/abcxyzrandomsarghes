import {
  ODD_CHIP_RULE_V1,
  SETTLEMENT_SCHEMA_V1,
  computeOutcomeHashV1,
  projectPublicSettlementV1,
  validateSettlementOutcomeV1,
  type PrivateHandRankV1,
  type PrivateSettlementOutcomeV1,
  type PublicSettlementOutcomeV1,
  type SettledPotV1,
  type UncalledRefundV1,
} from "./outcomeV1.ts";
import {
  type SettlementDbAction,
  type SettlementDbHand,
  type SettlementDbPlayer,
} from "./compute.ts";
import { compareRankVec, evaluateBestWithCards } from "../pokerEngine/evaluate.ts";
import { parseCard } from "../pokerEngine/deck.ts";
import type { Card } from "../pokerEngine/types.ts";
import { computePotBreakdown, contributionsFromActions } from "../trackerEngine/potEngine.ts";
import { entryKey, orderClockwiseAfterButton, type EntryKey } from "./participantIdentity.ts";

const RANK_NAME: Record<number, string> = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "T",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2",
};

export type HistoricalDisplayVerificationInput = {
  tournamentId: string;
  hand: SettlementDbHand;
  players: readonly SettlementDbPlayer[];
  actions: readonly SettlementDbAction[];
  sourceRevision: number;
  sourceChainHash: string;
  settlementRevision?: number;
  actor?: { userId: string; role: string };
};

export type HistoricalDisplayVerificationResult = {
  privateOutcome: PrivateSettlementOutcomeV1;
  publicOutcome: PublicSettlementOutcomeV1;
  winnerIds: readonly string[];
};

export class HistoricalDisplayVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new HistoricalDisplayVerificationError(code);
}

function chip(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function safeSum(values: readonly number[], code: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) fail(code);
  return total;
}

function actionId(action: SettlementDbAction): string {
  return action.id && action.id.trim() ? action.id : `${action.hand_id}:${action.action_order}`;
}

function validateCards(board: readonly string[], players: readonly SettlementDbPlayer[]): void {
  const seen = new Set<string>();
  for (const card of board) {
    try {
      parseCard(card as Card);
    } catch {
      fail("invalid_community_card");
    }
    if (seen.has(card)) fail("duplicate_card");
    seen.add(card);
  }
  for (const player of players) {
    for (const card of player.hole_cards ?? []) {
      try {
        parseCard(card as Card);
      } catch {
        fail("invalid_hole_card");
      }
      if (seen.has(card)) fail("duplicate_card");
      seen.add(card);
    }
  }
}

function handRank(player: SettlementDbPlayer, board: readonly string[]): PrivateHandRankV1 {
  const holeCards = player.hole_cards ?? [];
  const evaluated = evaluateBestWithCards([...holeCards, ...board] as Card[]);
  return {
    playerId: player.player_id,
    category: evaluated.categoryName,
    bestFive: [...evaluated.bestFive],
    kickers: evaluated.rankVec.slice(2).map((value) => RANK_NAME[value] ?? String(value)),
    // `hole_cards` are already part of the persisted public replay projection.
    // This verification path never adds a card that the hand itself did not save.
    isPublic: true,
    holeCards: [...holeCards],
    evaluatorInput: { rankVec: evaluated.rankVec },
  };
}

function sourceRefundAction(actions: readonly SettlementDbAction[], playerId: string): SettlementDbAction {
  const source = [...actions]
    .filter((action) => action.player_id === playerId)
    .sort((left, right) => right.action_order - left.action_order)
    .find((action) => action.action_amount > 0
      && ["bet", "raise", "all_in", "post_sb", "post_bb", "post_ante"].includes(action.action_type));
  return source ?? fail("refund_source_action_missing");
}

/**
 * Early Tracker hands persisted the forced bets under their old labels. The
 * historical proof uses the current pot engine, so normalize only this
 * read-only input before calculating contributions. The raw action rows stay
 * in the source hash and audit evidence unchanged.
 */
function normalizeHistoricalPotActions(actions: readonly SettlementDbAction[]): SettlementDbAction[] {
  const aliases: Record<string, string> = {
    small_blind: "post_sb",
    big_blind: "post_bb",
    ante: "post_ante",
    bb_ante: "post_ante",
  };
  return actions.map((action) => ({
    ...action,
    action_type: aliases[action.action_type] ?? action.action_type,
  }));
}

/**
 * Verifies one completed historical hand without reading or changing later hands,
 * current chip projections, entries, seats, or the original hand rows.
 */
export async function verifyHistoricalDisplaySettlement(
  input: HistoricalDisplayVerificationInput,
): Promise<HistoricalDisplayVerificationResult> {
  const { hand } = input;
  if (hand.tournament_id !== input.tournamentId || hand.status !== "completed" || hand.is_voided) {
    fail("invalid_historical_hand_state");
  }
  if (!Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 1 || !/^[0-9a-f]{64}$/.test(input.sourceChainHash)) {
    fail("invalid_historical_source");
  }
  if (!Number.isSafeInteger(input.settlementRevision ?? 1) || (input.settlementRevision ?? 1) < 1) {
    fail("invalid_historical_settlement_revision");
  }
  if (!hand.tracker_level_id || !Number.isSafeInteger(hand.tracker_level_number)
    || !Number.isSafeInteger(hand.tracker_small_blind) || (hand.tracker_small_blind ?? 0) <= 0
    || !Number.isSafeInteger(hand.tracker_big_blind) || (hand.tracker_big_blind ?? 0) < (hand.tracker_small_blind ?? 0)
    || !Number.isSafeInteger(hand.tracker_bba) || (hand.tracker_bba ?? -1) < 0
    || hand.tracker_is_break === true) {
    fail("historical_blind_snapshot_missing");
  }

  const players = input.players.map((player) => ({ ...player }));
  const actions = input.actions.map((action) => ({ ...action }));
  if (players.length < 2) fail("historical_players_missing");
  if (players.some((player) => player.hand_id !== hand.id)) fail("historical_player_hand_mismatch");
  if (actions.some((action) => action.hand_id !== hand.id)) fail("historical_action_hand_mismatch");

  const playersByEntry = new Map<EntryKey, SettlementDbPlayer>();
  const playerIds = new Set<string>();
  const seats = new Set<number>();
  for (const player of players) {
    let key: EntryKey;
    try { key = entryKey(player); } catch { fail("invalid_historical_entry"); }
    if (playerIds.has(player.player_id) || playersByEntry.has(key)) fail("duplicate_historical_player");
    if (!Number.isSafeInteger(player.entry_number) || player.entry_number < 1 || !Number.isSafeInteger(player.seat_number) || player.seat_number < 1 || seats.has(player.seat_number)) {
      fail("invalid_historical_seat");
    }
    chip(player.starting_stack, "invalid_historical_starting_stack");
    chip(player.ending_stack, "invalid_historical_ending_stack");
    if (typeof player.is_eliminated !== "boolean") fail("invalid_historical_elimination_state");
    playersByEntry.set(key, player);
    playerIds.add(player.player_id);
    seats.add(player.seat_number);
  }

  const actionOrders = new Set<number>();
  const actionIds = new Set<string>();
  for (const action of actions) {
    let key: EntryKey;
    try { key = entryKey(action); } catch { fail("historical_action_identity_mismatch"); }
    const player = playersByEntry.get(key);
    if (!player || !Number.isSafeInteger(action.action_order) || action.action_order < 1 || actionOrders.has(action.action_order)) {
      fail("historical_action_identity_mismatch");
    }
    const id = actionId(action);
    if (actionIds.has(id)) fail("duplicate_historical_action");
    chip(action.action_amount ?? 0, "invalid_historical_action_amount");
    actionIds.add(id);
    actionOrders.add(action.action_order);
  }

  const board = [...(hand.community_cards ?? [])];
  validateCards(board, players);
  const potActions = normalizeHistoricalPotActions(actions);
  const contributions = contributionsFromActions(potActions);
  const entryByPlayerId = new Map(players.map((player) => [player.player_id, entryKey(player)]));
  const committedByEntry = new Map(contributions.map((row) => [entryByPlayerId.get(row.player_id)!, row]));
  for (const player of players) {
    const committed = committedByEntry.get(entryKey(player))?.total_bet ?? 0;
    if (!Number.isSafeInteger(committed) || committed > chip(player.starting_stack, "invalid_historical_starting_stack")) {
      fail("historical_action_exceeds_stack");
    }
  }

  const breakdown = computePotBreakdown(contributions);
  const folded = new Set(contributions.filter((row) => row.is_folded).map((row) => entryByPlayerId.get(row.player_id)!));
  const survivors = players.filter((player) => !folded.has(entryKey(player)));
  const refundOnly = breakdown.pots.length === 0 && breakdown.totalPot === 0
    && breakdown.totalCommitted > 0 && breakdown.uncalled?.amount === breakdown.totalCommitted
    && survivors.length === 1 && survivors[0].player_id === breakdown.uncalled.player_id;
  if ((!refundOnly && breakdown.pots.length === 0) || !Number.isSafeInteger(breakdown.totalPot) || !Number.isSafeInteger(breakdown.totalCommitted)) {
    fail("historical_empty_or_invalid_pot");
  }
  const storedPot = hand.pot_size == null ? 0 : chip(hand.pot_size, "invalid_historical_pot_size");
  if (storedPot > 0 && storedPot !== breakdown.totalPot && storedPot !== breakdown.totalCommitted) {
    fail("historical_pot_size_mismatch");
  }

  const awards = new Map<EntryKey, number>();
  const ranksByEntry = new Map<EntryKey, PrivateHandRankV1>();
  const pots: SettledPotV1[] = [];
  const winnerIds = new Set<string>();

  for (const [index, layer] of breakdown.pots.entries()) {
    const eligible = players.filter((player) => layer.eligible_player_ids.includes(player.player_id) && !folded.has(entryKey(player)));
    if (eligible.length === 0) fail("historical_pot_has_no_eligible_player");
    let winners: SettlementDbPlayer[];
    if (eligible.length === 1) {
      winners = eligible;
    } else {
      if (board.length !== 5 || eligible.some((player) => (player.hole_cards ?? []).length !== 2)) {
        fail("incomplete_showdown_cards");
      }
      const ranked = eligible.map((player) => ({
        player,
        evaluated: evaluateBestWithCards([...(player.hole_cards ?? []), ...board] as Card[]),
      }));
      const best = ranked.reduce((winner, candidate) => compareRankVec(candidate.evaluated.rankVec, winner) > 0 ? candidate.evaluated.rankVec : winner, ranked[0].evaluated.rankVec);
      winners = ranked.filter((candidate) => compareRankVec(candidate.evaluated.rankVec, best) === 0).map((candidate) => candidate.player);
      for (const winner of winners) {
        // Public replay only needs the winning hand's rank. Keep a side-pot
        // winner unique without publishing a losing showdown player's rank.
        const key = entryKey(winner);
        if (!ranksByEntry.has(key)) {
          ranksByEntry.set(key, handRank(winner, board));
        }
      }
    }

    const orderedWinners = orderClockwiseAfterButton(winners, hand.button_seat);
    const share = Math.floor(layer.amount / orderedWinners.length);
    const oddChipCount = layer.amount - share * orderedWinners.length;
    const potId = index === 0 ? "main-0" : `side-${index}`;
    const allocations = orderedWinners.map((winner, winnerIndex) => {
      const amount = share + (winnerIndex < oddChipCount ? 1 : 0);
      const key = entryKey(winner);
      awards.set(key, safeSum([awards.get(key) ?? 0, amount], "historical_award_overflow"));
      winnerIds.add(winner.player_id);
      return { potId, winnerId: winner.player_id, amount, includesOddChip: winnerIndex < oddChipCount };
    });
    pots.push({
      potId,
      kind: index === 0 ? "main" : "side",
      amount: layer.amount,
      eligiblePlayerIds: [...layer.eligible_player_ids],
      winnerIds: allocations.map((allocation) => allocation.winnerId),
      allocations,
    });
  }

  const refund = breakdown.uncalled?.amount ?? 0;
  const refunds: UncalledRefundV1[] = breakdown.uncalled
    ? [{
      playerId: breakdown.uncalled.player_id,
      amount: refund,
      sourceActionId: actionId(sourceRefundAction(potActions, breakdown.uncalled.player_id)),
    }]
    : [];
  const settlements = players.map((player) => {
    const startingStack = chip(player.starting_stack, "invalid_historical_starting_stack");
    const key = entryKey(player);
    const committedTotal = committedByEntry.get(key)?.total_bet ?? 0;
    const potAward = awards.get(key) ?? 0;
    const playerRefund = breakdown.uncalled?.player_id === player.player_id ? refund : 0;
    const creditedTotal = safeSum([potAward, playerRefund], "historical_credit_overflow");
    const netDelta = creditedTotal - committedTotal;
    const endingStack = startingStack + netDelta;
    if (!Number.isSafeInteger(endingStack) || endingStack < 0) fail("historical_ending_stack_invalid");
    if (chip(player.ending_stack, "invalid_historical_ending_stack") !== endingStack) fail("stored_ending_stack_mismatch");
    if (player.is_eliminated !== (endingStack === 0)) fail("stored_elimination_mismatch");
    return { playerId: player.player_id, startingStack, committedTotal, potAward, refund: playerRefund, creditedTotal, netDelta, externalDelta: 0, endingStack };
  });

  const totals = {
    startingStack: safeSum(settlements.map((player) => player.startingStack), "historical_total_overflow"),
    committedTotal: safeSum(settlements.map((player) => player.committedTotal), "historical_total_overflow"),
    distributablePot: breakdown.totalPot,
    refundTotal: refund,
    potAward: safeSum(pots.flatMap((pot) => pot.allocations.map((allocation) => allocation.amount)), "historical_total_overflow"),
    creditedTotal: safeSum(settlements.map((player) => player.creditedTotal), "historical_total_overflow"),
    netDelta: safeSum(settlements.map((player) => player.netDelta), "historical_total_overflow"),
    externalDelta: 0,
    endingStack: safeSum(settlements.map((player) => player.endingStack), "historical_total_overflow"),
  };
  if (totals.startingStack !== totals.endingStack || totals.committedTotal !== breakdown.totalCommitted || totals.potAward !== breakdown.totalPot || totals.refundTotal !== refund) {
    fail("historical_chip_conservation_failed");
  }

  const privateOutcome: PrivateSettlementOutcomeV1 = {
    schemaVersion: SETTLEMENT_SCHEMA_V1,
    status: "verified",
    sourceRevision: input.sourceRevision,
    sourceChainHash: input.sourceChainHash,
    settlementRevision: input.settlementRevision ?? 1,
    outcomeHash: "0".repeat(64),
    ruleVersion: ODD_CHIP_RULE_V1,
    players: settlements,
    pots,
    refunds,
    handRanks: [...ranksByEntry.values()],
    totals,
    privateEvidence: {
      targetHandId: hand.id,
      buttonSeat: hand.button_seat,
      communityCards: board,
      seats: players.map((player) => ({ seatNumber: player.seat_number, playerId: player.player_id, startingStack: player.starting_stack })),
      actions: actions.map((action) => ({ actionId: actionId(action), actionOrder: action.action_order, playerId: action.player_id, street: action.street, actionType: action.action_type, amount: action.action_amount ?? 0 })),
      sourceChain: [{ handId: hand.id, handNumber: hand.hand_number, sourceRevision: input.sourceRevision, sourceHash: input.sourceChainHash }],
      externalAdjustments: [],
      holeCardsByPlayer: Object.fromEntries(players.filter((player) => (player.hole_cards ?? []).length === 2).map((player) => [player.player_id, player.hole_cards ?? []])),
      muckedHoleCardsByPlayer: {},
      actor: input.actor,
    },
  };
  privateOutcome.outcomeHash = await computeOutcomeHashV1(privateOutcome);
  const validation = validateSettlementOutcomeV1(privateOutcome);
  if (!validation.ok) fail(`historical_contract_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  return { privateOutcome, publicOutcome: projectPublicSettlementV1(privateOutcome), winnerIds: [...winnerIds] };
}
