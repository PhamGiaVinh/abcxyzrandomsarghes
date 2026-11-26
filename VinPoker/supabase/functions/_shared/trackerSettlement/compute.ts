import {
  ODD_CHIP_RULE_V1,
  SETTLEMENT_SCHEMA_V1,
  canonicalJsonV1,
  computeOutcomeHashV1,
  computeSourceChainHashV1,
  projectPublicSettlementV1,
  validateSettlementOutcomeV1,
  type PrivateSettlementOutcomeV1,
  type PublicSettlementOutcomeV1,
  type PotAllocation,
  type PrivateHandRankV1,
  type SettlementSourceHandRevisionV1,
} from "./outcomeV1.ts";
import {
  compareRankVec,
  evaluateBest,
  evaluateBestWithCards,
  type HandCategoryName,
} from "../pokerEngine/evaluate.ts";
import type { Card } from "../pokerEngine/types.ts";
import { computePotBreakdown, contributionsFromActions, toSidePotsJson } from "../trackerEngine/potEngine.ts";
import { isRunout, nextToAct, reduceHand, STREET_ORDER } from "../trackerEngine/handState.ts";
import { validateAction } from "../trackerEngine/validateAction.ts";
import type { ActionRow, PlayerSeed, Street, TrackerActionType } from "../trackerEngine/types.ts";
import { entryKey, orderClockwiseAfterButton, type EntryKey } from "./participantIdentity.ts";

export type SettlementDbHand = {
  id: string;
  tournament_id: string;
  hand_number: number;
  table_id: string;
  button_seat: number;
  community_cards: string[] | null;
  pot_size: number | null;
  side_pots: unknown;
  status: string;
  is_voided: boolean | null;
  updated_at: string | null;
  created_at: string;
  source_revision?: number;
  table_session_id?: string | null;
  tracker_level_id?: string | null;
  tracker_level_number?: number | null;
  tracker_small_blind?: number | null;
  tracker_big_blind?: number | null;
  tracker_bba?: number | null;
  tracker_big_blind_ante_only?: boolean;
  tracker_bb_position?: number | null;
  tracker_is_break?: boolean | null;
  tracker_blind_evidence?: unknown;
};

export type SettlementDbPlayer = {
  hand_id: string;
  player_id: string;
  entry_number: number;
  seat_number: number;
  starting_stack: number;
  ending_stack: number | null;
  hole_cards: string[] | null;
  is_eliminated?: boolean | null;
};

export type SettlementDbAction = {
  id?: string;
  hand_id: string;
  player_id: string;
  entry_number: number;
  street: string;
  action_type: string;
  action_amount: number | null;
  action_order: number;
};

/** The saved rule and seat determine the ante payer; action edits cannot choose it. */
export function frozenBigBlindAntePlayerId(hand: SettlementDbHand, players: readonly SettlementDbPlayer[]): string | undefined {
  if (hand.tracker_big_blind_ante_only !== true) return undefined;
  const payer = players.filter(player => player.seat_number === hand.tracker_bb_position);
  if (!Number.isSafeInteger(hand.tracker_big_blind) || (hand.tracker_big_blind ?? 0) <= 0
    || hand.tracker_bba !== hand.tracker_big_blind || !Number.isSafeInteger(hand.tracker_bb_position)
    || (hand.tracker_bb_position ?? 0) < 1 || (hand.tracker_bb_position ?? 0) > 10 || payer.length !== 1) {
    throw new Error("invalid_big_blind_ante_snapshot");
  }
  return payer[0].player_id;
}

export type SettlementLiveStack = {
  player_id: string;
  entry_number: number;
  chip_count: number;
};

export type SettlementEdit = {
  communityCards?: string[];
  holeCards?: Array<{ player_id: string; entry_number?: number; hole_cards: string[] }>;
  actions?: SettlementDbAction[];
  potSize?: number;
  sidePots?: unknown;
};

/** Exact server-shaped edit persisted by the atomic correction writer. */
export type SettlementPersistedEdit = {
  community_cards?: string[];
  hole_cards?: Array<{ player_id: string; entry_number?: number; hole_cards: string[] }>;
  actions?: SettlementDbAction[];
  pot_size?: number;
  side_pots?: unknown;
};

export type SettlementHandChange = {
  hand_id: string;
  player_id: string;
  entry_number: number;
  starting_stack: number;
  ending_stack: number;
};

export type SettlementFinalStack = SettlementLiveStack & {
  expected_current: number;
};

export type AuthoritativeSettlementInput = {
  tournamentId: string;
  targetHandId: string;
  hands: readonly SettlementDbHand[];
  players: readonly SettlementDbPlayer[];
  actions: readonly SettlementDbAction[];
  liveStacks: readonly SettlementLiveStack[];
  edit?: SettlementEdit;
  actor?: { userId: string; role: string };
  sourceRevisionOverride?: number;
  sourceChainHashOverride?: string;
  settlementRevisionOverride?: number;
};

export type AuthoritativeSettlementResult = {
  privateOutcome: PrivateSettlementOutcomeV1;
  publicOutcome: PublicSettlementOutcomeV1;
  handChanges: SettlementHandChange[];
  finalStacks: SettlementFinalStack[];
  winnerIds: string[];
  affectedHandCount: number;
  affectedPlayerCount: number;
  persistedEdit: SettlementPersistedEdit;
};

export type SettlementSourceRpcRow = {
  source_revision?: unknown;
  source_chain_hash?: unknown;
};

export function normalizeSettlementSourceRpcResult(value: unknown): {
  sourceRevision: number;
  sourceChainHash: string;
} {
  const row = (Array.isArray(value) ? value[0] : value) as SettlementSourceRpcRow | null | undefined;
  const sourceRevision = Number(row?.source_revision);
  const sourceChainHash = typeof row?.source_chain_hash === "string" ? row.source_chain_hash : "";
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !/^[0-9a-f]{64}$/.test(sourceChainHash)) {
    throw new Error("invalid_settlement_source");
  }
  return { sourceRevision, sourceChainHash };
}

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

function chips(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`invalid_chip:${field}`);
  }
  return value as number;
}

function revisionOf(hand: SettlementDbHand): number {
  if (Number.isSafeInteger(hand.source_revision) && (hand.source_revision as number) >= 1) {
    return hand.source_revision as number;
  }
  const parsed = hand.updated_at ? Date.parse(hand.updated_at) : 0;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonV1(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function handRank(player: SettlementDbPlayer, board: string[]): PrivateHandRankV1 | null {
  const holeCards = player.hole_cards ?? [];
  if (holeCards.length !== 2 || board.length !== 5) return null;
  const evaluated = evaluateBestWithCards([...holeCards, ...board] as Card[]);
  const kickers = evaluated.rankVec.slice(2).map((value) => RANK_NAME[value] ?? String(value));
  return {
    playerId: player.player_id,
    category: evaluated.categoryName as HandCategoryName,
    bestFive: [...evaluated.bestFive],
    kickers,
    isPublic: true,
    holeCards: [...holeCards],
    evaluatorInput: { rankVec: evaluated.rankVec },
  };
}

function ensureUniqueEntries(players: readonly SettlementDbPlayer[]): void {
  const entries = new Set<string>();
  const playersByHand = new Set<string>();
  for (const player of players) {
    const key = entryKey(player);
    const handEntry = `${player.hand_id}:${key}`;
    const handPlayer = `${player.hand_id}:${player.player_id}`;
    if (entries.has(handEntry) || playersByHand.has(handPlayer)) throw new Error("duplicate_hand_participant");
    entries.add(handEntry);
    playersByHand.add(handPlayer);
  }
}

function targetActions(input: AuthoritativeSettlementInput, target: SettlementDbHand): SettlementDbAction[] {
  const original = input.actions.filter((action) => action.hand_id === target.id);
  return (input.edit?.actions ?? original).map((action, index) => ({
    ...action,
    id: action.id ?? `${target.id}:${action.action_order ?? index + 1}`,
    hand_id: target.id,
  }));
}

function targetPlayers(input: AuthoritativeSettlementInput, target: SettlementDbHand): SettlementDbPlayer[] {
  const players = input.players.filter((player) => player.hand_id === target.id).map((player) => ({ ...player }));
  const holes = new Map<string, string[]>();
  for (const row of input.edit?.holeCards ?? []) {
    const key = `${row.player_id}:${row.entry_number ?? 1}`;
    if (holes.has(key) || !players.some((player) => `${player.player_id}:${player.entry_number}` === key)) {
      throw new Error("invalid_card_set");
    }
    holes.set(key, row.hole_cards);
  }
  for (const player of players) {
    const edited = holes.get(`${player.player_id}:${player.entry_number}`);
    if (edited) player.hole_cards = [...edited];
  }
  return players;
}

function boardFor(input: AuthoritativeSettlementInput, target: SettlementDbHand): string[] {
  return [...(input.edit?.communityCards ?? target.community_cards ?? [])];
}

function validateCardSet(board: readonly string[], players: readonly SettlementDbPlayer[]): void {
  if (![0, 3, 4, 5].includes(board.length)) throw new Error("invalid_card_set");
  const seen = new Set<string>();
  const addCards = (cards: readonly string[]) => {
    for (const card of cards) {
      if (!/^[AKQJT2-9][shdc]$/.test(card) || seen.has(card)) throw new Error("invalid_card_set");
      seen.add(card);
    }
  };
  addCards(board);
  for (const player of players) {
    const holeCards = player.hole_cards ?? [];
    if (!Array.isArray(holeCards) || (holeCards.length !== 0 && holeCards.length !== 2)) {
      throw new Error("invalid_card_set");
    }
    addCards(holeCards);
  }
}

function actionSourceId(action: SettlementDbAction): string {
  return action.id ?? `${action.hand_id}:${action.action_order}`;
}

const STREETS = new Set<Street>(["preflop", "flop", "turn", "river", "showdown"]);
const ACTION_TYPES = new Set<TrackerActionType>([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);
const POSTING_ACTIONS = new Set<TrackerActionType>(["post_sb", "post_bb", "post_ante"]);

/**
 * Replay the effective action stream through the shared hand core before the
 * settlement engine sees it. The recorded status is not proof that this stream
 * actually reached a settlement-ready terminal state.
 */
function validateEditedTargetActions(
  target: SettlementDbHand,
  players: readonly SettlementDbPlayer[],
  actions: readonly SettlementDbAction[],
  board: readonly string[],
): void {
  const seeds: PlayerSeed[] = players.map((player) => ({
    player_id: player.player_id,
    seat_number: player.seat_number,
    starting_stack: chips(player.starting_stack, `${player.player_id}.starting_stack`),
  }));
  const entries = new Map(players.map((player) => [player.player_id, player.entry_number]));
  const sorted = [...actions].sort((left, right) => left.action_order - right.action_order || actionSourceId(left).localeCompare(actionSourceId(right)));
  const accepted: ActionRow[] = [];
  const actionOrders = new Set<number>();
  let priorStreet = -1;

  for (const action of sorted) {
    if (!Number.isSafeInteger(action.action_order) || action.action_order <= 0 || actionOrders.has(action.action_order)) {
      throw new Error(`edited_action_invalid:${action.action_order}:action_order`);
    }
    actionOrders.add(action.action_order);
    const street = STREETS.has(action.street as Street) ? action.street as Street : null;
    const actionType = ACTION_TYPES.has(action.action_type as TrackerActionType)
      ? action.action_type as TrackerActionType
      : null;
    const expectedEntry = entries.get(action.player_id);
    if (!street || !actionType || expectedEntry === undefined || expectedEntry !== action.entry_number) {
      throw new Error(`edited_action_invalid:${action.action_order}:identity_or_type`);
    }
    if (!Number.isSafeInteger(action.action_amount) || (action.action_amount ?? 0) < 0) {
      throw new Error(`edited_action_invalid:${action.action_order}:amount`);
    }
    const currentStreet = ["preflop", "flop", "turn", "river", "showdown"].indexOf(street);
    if (currentStreet < priorStreet) {
      throw new Error(`edited_action_invalid:${action.action_order}:street_regression`);
    }

    const proposed: ActionRow = {
      player_id: action.player_id,
      street,
      action_type: actionType,
      action_amount: action.action_amount ?? 0,
      action_order: action.action_order,
    };
    const verdict = validateAction(
      seeds,
      accepted,
      target.button_seat,
      proposed,
      { enforceTurnOrder: !POSTING_ACTIONS.has(actionType) },
    );
    if (!verdict.valid) throw new Error(`edited_action_invalid:${action.action_order}:${verdict.code}`);
    if (verdict.normalizedAmount !== proposed.action_amount) {
      throw new Error(`edited_action_invalid:${action.action_order}:AMOUNT_MISMATCH`);
    }
    accepted.push(proposed);
    priorStreet = currentStreet;
  }

  const runtime = reduceHand(seeds, accepted, target.button_seat);
  const requiredBoardSize = runtime.street === "preflop" ? 0
    : runtime.street === "flop" ? 3
    : runtime.street === "turn" ? 4
    : 5;
  if (board.length < requiredBoardSize) throw new Error("incomplete_board_for_street");
  const livePlayers = runtime.players.filter((player) => !player.is_folded);
  if (livePlayers.length === 1) return;

  if (nextToAct(seeds, accepted, target.button_seat) !== null) {
    throw new Error("incomplete_action_stream");
  }
  const reachedRiver = STREET_ORDER.indexOf(runtime.street) >= STREET_ORDER.indexOf("river");
  if (!reachedRiver && !isRunout(runtime)) throw new Error("incomplete_action_stream");
}

function persistedEdit(
  edit: SettlementEdit | undefined,
  actions: readonly SettlementDbAction[],
  breakdown: ReturnType<typeof computePotBreakdown>,
): SettlementPersistedEdit {
  const result: SettlementPersistedEdit = {};
  if (edit?.communityCards !== undefined) result.community_cards = [...edit.communityCards];
  if (edit?.holeCards !== undefined) {
    result.hole_cards = edit.holeCards.map((row) => ({
      player_id: row.player_id,
      entry_number: row.entry_number,
      hole_cards: [...row.hole_cards],
    }));
  }
  if (edit?.actions !== undefined) {
    result.actions = actions.map((action) => ({ ...action }));
    result.pot_size = breakdown.totalPot;
    result.side_pots = toSidePotsJson(breakdown);
  }
  return result;
}

function sourceActionForRefund(actions: readonly SettlementDbAction[], playerId: string): SettlementDbAction {
  const candidates = actions
    .filter((action) => action.player_id === playerId)
    .sort((left, right) => right.action_order - left.action_order);
  const source = candidates.find((action) => ["bet", "raise", "all_in"].includes(action.action_type)) ?? candidates[0];
  if (!source) throw new Error("refund_source_action_missing");
  return source;
}

async function sourceChain(input: AuthoritativeSettlementInput): Promise<{
  sourceChain: PrivateSettlementOutcomeV1["privateEvidence"]["sourceChain"];
  sourceChainHash: string;
}> {
  const sortedHands = [...input.hands].sort((left, right) => left.hand_number - right.hand_number || left.id.localeCompare(right.id));
  const sourceChain: SettlementSourceHandRevisionV1[] = [];
  for (const hand of sortedHands) {
    const handPlayers = input.players.filter((player) => player.hand_id === hand.id).sort((a, b) => a.seat_number - b.seat_number);
    const handActions = input.actions.filter((action) => action.hand_id === hand.id).sort((a, b) => a.action_order - b.action_order);
    const sourceHash = await sha256Json({ hand, players: handPlayers, actions: handActions });
    const sourceRevision = hand.id === input.targetHandId && input.sourceRevisionOverride !== undefined
      ? input.sourceRevisionOverride
      : revisionOf(hand);
    sourceChain.push({ handId: hand.id, handNumber: hand.hand_number, sourceRevision, sourceHash });
  }
  const target = input.hands.find((hand) => hand.id === input.targetHandId);
  if (!target) throw new Error("target_hand_not_found");
  return {
    sourceChain,
    sourceChainHash: await computeSourceChainHashV1({
      targetHandId: target.id,
      buttonSeat: target.button_seat,
      communityCards: boardFor(input, target),
      seats: [],
      actions: [],
      sourceChain,
      externalAdjustments: [],
      holeCardsByPlayer: {},
      muckedHoleCardsByPlayer: {},
    }),
  };
}

export async function computeAuthoritativeSettlement(
  input: AuthoritativeSettlementInput,
): Promise<AuthoritativeSettlementResult> {
  const sortedHands = [...input.hands].sort((left, right) => left.hand_number - right.hand_number || left.id.localeCompare(right.id));
  const targetIndex = sortedHands.findIndex((hand) => hand.id === input.targetHandId);
  if (targetIndex < 0) throw new Error("target_hand_not_found");
  const chain = sortedHands.slice(targetIndex);
  if (chain.some((hand) => hand.status === "in_progress" || hand.is_voided)) throw new Error("invalid_chain_state");
  ensureUniqueEntries(input.players);

  const target = chain[0];
  const players = targetPlayers(input, target);
  const actions = targetActions(input, target);
  const board = boardFor(input, target);
  if (players.length === 0) throw new Error("target_players_missing");
  validateCardSet(board, players);
  validateEditedTargetActions(target, players, actions, board);

  const entryKeyByPlayerId = new Map(players.map((player) => [player.player_id, entryKey(player)]));
  const contributions = contributionsFromActions(actions, frozenBigBlindAntePlayerId(target, players));
  const contributionByEntry = new Map(contributions.map((row) => [entryKeyByPlayerId.get(row.player_id)!, row]));
  for (const player of players) {
    const starting = chips(player.starting_stack, `${player.player_id}.starting_stack`);
    const committed = contributionByEntry.get(entryKey(player))?.total_bet ?? 0;
    if (committed > starting) throw new Error("target_action_exceeds_stack");
  }
  const breakdown = computePotBreakdown(contributions);
  if (breakdown.pots.length === 0) throw new Error("empty_pot");
  const folded = new Set(contributions.filter((row) => row.is_folded).map((row) => entryKeyByPlayerId.get(row.player_id)!));
  const awards = new Map<EntryKey, number>();
  const potAllocations: PotAllocation[] = [];
  const ranks: PrivateHandRankV1[] = [];
  const winnerIds = new Set<string>();

  for (const [potIndex, layer] of breakdown.pots.entries()) {
    const eligible = players.filter((player) => layer.eligible_player_ids.includes(player.player_id) && !folded.has(entryKey(player)));
    if (eligible.length === 0) throw new Error("pot_has_no_eligible_player");
    let winners: SettlementDbPlayer[];
    if (eligible.length === 1) {
      winners = eligible;
    } else {
      if (board.length !== 5 || eligible.some((player) => (player.hole_cards ?? []).length !== 2)) throw new Error("incomplete_showdown_cards");
      const ranked = eligible.map((player) => ({ player, rank: evaluateBest([...(player.hole_cards as string[]), ...board] as Card[]).rankVec }));
      const best = ranked.reduce((value, item) => compareRankVec(item.rank, value) > 0 ? item.rank : value, ranked[0].rank);
      winners = ranked.filter((item) => compareRankVec(item.rank, best) === 0).map((item) => item.player);
      for (const player of eligible) {
        const rank = handRank(player, board);
        if (rank) ranks.push(rank);
      }
    }
    const ordered = orderClockwiseAfterButton(winners, target.button_seat);
    const share = Math.floor(layer.amount / ordered.length);
    const odd = layer.amount - share * ordered.length;
    for (const [winnerIndex, winner] of ordered.entries()) {
      const amount = share + (winnerIndex < odd ? 1 : 0);
      const potId = potIndex === 0 ? "main-0" : `side-${potIndex}`;
      potAllocations.push({ potId, winnerId: winner.player_id, amount, includesOddChip: winnerIndex < odd });
      const key = entryKey(winner);
      awards.set(key, (awards.get(key) ?? 0) + amount);
      winnerIds.add(winner.player_id);
    }
  }

  const refund = breakdown.uncalled ? breakdown.uncalled.amount : 0;
  const refunds = breakdown.uncalled
    ? [{ playerId: breakdown.uncalled.player_id, amount: refund, sourceActionId: actionSourceId(sourceActionForRefund(actions, breakdown.uncalled.player_id)) }]
    : [];
  const ending = new Map<EntryKey, number>();
  for (const player of players) {
    const key = entryKey(player);
    const starting = chips(player.starting_stack, `${player.player_id}.starting_stack`);
    const committed = contributionByEntry.get(key)?.total_bet ?? 0;
    ending.set(key, starting - committed + (awards.get(key) ?? 0) + (breakdown.uncalled?.player_id === player.player_id ? refund : 0));
  }
  const startingTotal = players.reduce((sum, player) => sum + chips(player.starting_stack, `${player.player_id}.starting_stack`), 0);
  const endingTotal = [...ending.values()].reduce((sum, value) => sum + value, 0);
  if (startingTotal !== endingTotal) throw new Error("target_not_conserved");

  const handChanges: SettlementHandChange[] = [];
  const carry = new Map<EntryKey, number>();
  const oldDelta = new Map<EntryKey, number>();
  const newDelta = new Map<EntryKey, { identity: SettlementDbPlayer; value: number }>();
  for (const player of players) {
    const key = entryKey(player);
    const oldEnding = chips(player.ending_stack ?? 0, `${player.player_id}.ending_stack`);
    const nextEnding = ending.get(key)!;
    if ((oldEnding === 0) !== (nextEnding === 0)) throw new Error("bust_state_change_requires_void");
    carry.set(key, nextEnding);
    oldDelta.set(key, oldEnding);
    newDelta.set(key, { identity: player, value: nextEnding });
    if (oldEnding !== nextEnding) handChanges.push({ hand_id: target.id, player_id: player.player_id, entry_number: player.entry_number, starting_stack: chips(player.starting_stack, `${player.player_id}.starting_stack`), ending_stack: nextEnding });
  }
  for (const later of chain.slice(1)) {
    const laterPlayers = input.players.filter((player) => player.hand_id === later.id);
    const laterActions = input.actions.filter((action) => action.hand_id === later.id);
    const laterContributions = new Map(contributionsFromActions(laterActions).map((row) => [row.player_id, row.total_bet]));
    for (const player of laterPlayers) {
      const key = entryKey(player);
      const oldStart = chips(player.starting_stack, `${player.player_id}.starting_stack`);
      const oldEnd = chips(player.ending_stack ?? 0, `${player.player_id}.ending_stack`);
      const newStart = carry.get(key) ?? oldStart;
      const committed = laterContributions.get(player.player_id) ?? 0;
      if (committed > newStart) throw new Error(`later_hand_action_exceeds_stack:${later.hand_number}`);
      const newEnd = newStart + (oldEnd - oldStart);
      if (newEnd < 0 || (oldEnd === 0) !== (newEnd === 0)) throw new Error(`later_hand_state_divergence:${later.hand_number}`);
      carry.set(key, newEnd);
      oldDelta.set(key, oldEnd);
      newDelta.set(key, { identity: player, value: newEnd });
      if (newStart !== oldStart || newEnd !== oldEnd) handChanges.push({ hand_id: later.id, player_id: player.player_id, entry_number: player.entry_number, starting_stack: newStart, ending_stack: newEnd });
    }
  }

  const liveStacksByEntry = new Map<EntryKey, SettlementLiveStack>();
  for (const live of input.liveStacks) {
    const key = entryKey(live);
    if (liveStacksByEntry.has(key)) throw new Error(`live_stack_ambiguous:${key}`);
    liveStacksByEntry.set(key, live);
  }
  const finalStacks: SettlementFinalStack[] = [];
  for (const [key, { identity, value: next }] of newDelta) {
    const live = liveStacksByEntry.get(key);
    if (!live) throw new Error(`live_stack_missing:${key}`);
    const expected = chips(live.chip_count, `${key}.live_stack`);
    const delta = next - (oldDelta.get(key) ?? expected);
    const chipCount = expected + delta;
    if (chipCount < 0) throw new Error(`live_stack_negative:${key}`);
    if (live.player_id !== identity.player_id || live.entry_number !== identity.entry_number) throw new Error(`live_stack_identity_mismatch:${key}`);
    finalStacks.push({ ...live, expected_current: expected, chip_count: chipCount });
  }

  const chainData = await sourceChain(input);
  const targetEvidence = {
    targetHandId: target.id,
    buttonSeat: target.button_seat,
    communityCards: board,
    seats: players.map((player) => ({ seatNumber: player.seat_number, playerId: player.player_id, startingStack: chips(player.starting_stack, `${player.player_id}.starting_stack`) })),
    actions: actions.map((action) => ({ actionId: actionSourceId(action), actionOrder: action.action_order, playerId: action.player_id, street: action.street, actionType: action.action_type, amount: chips(action.action_amount ?? 0, `${actionSourceId(action)}.amount`) })),
    sourceChain: chainData.sourceChain,
    externalAdjustments: [],
    holeCardsByPlayer: Object.fromEntries(players.filter((player) => (player.hole_cards ?? []).length === 2).map((player) => [player.player_id, player.hole_cards!])),
    muckedHoleCardsByPlayer: {},
    actor: input.actor,
  };
  const privateOutcome: PrivateSettlementOutcomeV1 = {
    schemaVersion: SETTLEMENT_SCHEMA_V1,
    status: "verified",
    sourceRevision: input.sourceRevisionOverride ?? revisionOf(target),
    sourceChainHash: input.sourceChainHashOverride ?? chainData.sourceChainHash,
    settlementRevision: input.settlementRevisionOverride ?? 1,
    outcomeHash: "0".repeat(64),
    ruleVersion: ODD_CHIP_RULE_V1,
    players: players.map((player) => {
      const key = entryKey(player);
      const startingStack = chips(player.starting_stack, `${player.player_id}.starting_stack`);
      const committedTotal = contributionByEntry.get(key)?.total_bet ?? 0;
      const potAward = awards.get(key) ?? 0;
      const playerRefund = breakdown.uncalled?.player_id === player.player_id ? refund : 0;
      const creditedTotal = potAward + playerRefund;
      const netDelta = creditedTotal - committedTotal;
      return { playerId: player.player_id, startingStack, committedTotal, potAward, refund: playerRefund, creditedTotal, netDelta, externalDelta: 0, endingStack: startingStack + netDelta };
    }),
    pots: breakdown.pots.map((pot, index) => ({
      potId: index === 0 ? "main-0" : `side-${index}`,
      kind: index === 0 ? "main" as const : "side" as const,
      amount: pot.amount,
      eligiblePlayerIds: [...pot.eligible_player_ids],
      winnerIds: potAllocations.filter((allocation) => allocation.potId === (index === 0 ? "main-0" : `side-${index}`)).map((allocation) => allocation.winnerId),
      allocations: potAllocations.filter((allocation) => allocation.potId === (index === 0 ? "main-0" : `side-${index}`)),
    })),
    refunds,
    handRanks: ranks,
    totals: {
      startingStack: startingTotal,
      committedTotal: breakdown.totalCommitted,
      distributablePot: breakdown.totalPot,
      refundTotal: refund,
      potAward: potAllocations.reduce((sum, allocation) => sum + allocation.amount, 0),
      creditedTotal: breakdown.totalPot + refund,
      netDelta: 0,
      externalDelta: 0,
      endingStack: endingTotal,
    },
    privateEvidence: targetEvidence,
  };
  privateOutcome.outcomeHash = await computeOutcomeHashV1(privateOutcome);
  const validation = validateSettlementOutcomeV1(privateOutcome);
  if (!validation.ok) throw new Error(`settlement_contract_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  return {
    privateOutcome,
    publicOutcome: projectPublicSettlementV1(privateOutcome),
    handChanges,
    finalStacks,
    winnerIds: [...winnerIds],
    affectedHandCount: new Set(handChanges.map((change) => change.hand_id)).size,
    affectedPlayerCount: new Set(handChanges.map((change) => entryKey(change))).size,
    persistedEdit: persistedEdit(input.edit, actions, breakdown),
  };
}
